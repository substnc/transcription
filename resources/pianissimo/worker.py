#!/usr/bin/env python3
"""Speak: kör NVIDIA NeMo-modeller lokalt, precis som modellkorten på Hugging Face beskriver.

Taligenkänning, Klang Pianissimo (KlangAI/pianissimo-sv):
    model = ASRModel.from_pretrained(model_name="KlangAI/pianissimo-sv", map_location=device).eval()
    with torch.inference_mode():
        hypotheses = model.transcribe(audio=[path], batch_size=1, return_hypotheses=True, timestamps=True)

Talarseparering, NVIDIA Nemotron 3 Diarization (nvidia/Nemotron-3-Diarization):
    diar_model = SortformerEncLabelModel.from_pretrained("nvidia/Nemotron-3-Diarization").eval()
    segments = diar_model.diarize(audio=[path], batch_size=1)   # rader "start end speaker_N"

Modellerna laddas först när de behövs och ligger sedan kvar i minnet. Arbetaren läser en JSON-rad per
uppdrag från stdin och svarar med en JSON-rad på stdout:

    {"id": 1, "cmd": "transcribe", "path": "/tmp/x.wav", "timestamps": true}
      -> {"id": 1, "ok": true, "text": "...", "segments": [...], "words": [...], "sec": 0.4}
    {"id": 2, "cmd": "diarize", "path": "/tmp/x.wav"}
      -> {"id": 2, "ok": true, "segments": [{"start": 0.0, "end": 2.1, "speaker": 0}, ...], "sec": 1.2}
    {"id": 3, "cmd": "load", "what": "asr" | "diar"}
      -> {"id": 3, "ok": true, "load_sec": 5.1}

Ljudet ska vara 16 kHz mono WAV. Inget skickas över nätet: appen startar arbetaren med
HF_HUB_OFFLINE=1 och modellerna ligger redan i den lokala cachen.
"""

import json
import os
import re
import sys
import time

MODELS = {"asr": "KlangAI/pianissimo-sv", "diar": "nvidia/Nemotron-3-Diarization"}

# Allt som NeMo, PyTorch eller andra bibliotek skriver till stdout flyttas till stderr (loggen),
# så att stdout bara innehåller våra JSON-svar.
_out = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr


def send(obj):
    _out.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _out.flush()


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def pick_device(torch):
    # Macens grafikkrets (MPS) när den finns, annars processorn. SPEAK_DEVICE=cpu tvingar processorn.
    want = os.environ.get("SPEAK_DEVICE", "auto")
    if want != "cpu" and torch.cuda.is_available():
        return torch.device("cuda")
    if want != "cpu" and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class Models:
    def __init__(self, torch):
        self.torch = torch
        self.device = pick_device(torch)
        self.loaded = {}

    def to_cpu(self, what, err):
        # Något i modellen fungerade inte på grafikkretsen: kör den på processorn från och med nu.
        print(f"[arbetare] {MODELS[what]} på {self.device} misslyckades ({err}), byter till cpu", file=sys.stderr)
        self.loaded[what] = self.loaded[what].to("cpu")
        self.device = self.torch.device("cpu")

    def run(self, what, fn):
        m = self.get(what)
        try:
            return fn(m)
        except Exception as e:  # noqa: BLE001
            if self.device.type == "cpu":
                raise
            self.to_cpu(what, e)
            return fn(self.loaded[what])

    def get(self, what):
        if what not in self.loaded:
            t0 = time.monotonic()
            if what == "asr":
                from nemo.collections.asr.models import ASRModel
                m = ASRModel.from_pretrained(model_name=MODELS["asr"], map_location=self.device).eval()
            elif what == "diar":
                from nemo.collections.asr.models import SortformerEncLabelModel
                m = SortformerEncLabelModel.from_pretrained(MODELS["diar"], map_location=self.device).eval()
            else:
                raise ValueError(f"okänd modell: {what}")
            self.loaded[what] = m
            print(f"[arbetare] {MODELS[what]} laddad på {time.monotonic() - t0:.1f} s", file=sys.stderr)
        return self.loaded[what]


def transcribe(models, req):
    want_ts = bool(req.get("timestamps"))

    def run(model):
        with models.torch.inference_mode():
            return model.transcribe(audio=[req["path"]], batch_size=1, return_hypotheses=True, timestamps=want_ts)
    hypotheses = models.run("asr", run)
    h = hypotheses[0]
    if isinstance(h, list):  # vissa NeMo-versioner ger en lista per fil
        h = h[0]
    out = {"text": getattr(h, "text", str(h)) or ""}
    if want_ts:
        ts = getattr(h, "timestamp", None) or {}
        out["segments"] = [{"start": num(s.get("start")), "end": num(s.get("end")), "text": s.get("segment", "")} for s in ts.get("segment", [])]
        out["words"] = [{"start": num(w.get("start")), "end": num(w.get("end")), "word": w.get("word", "")} for w in ts.get("word", [])]
    return out


def diarize(models, req):
    def run(model):
        with models.torch.inference_mode():
            return model.diarize(audio=[req["path"]], batch_size=1, verbose=False)
    result = models.run("diar", run)
    if isinstance(result, tuple):  # (rader, tensorer) om include_tensor_outputs
        result = result[0]
    lines = result[0] if result and isinstance(result[0], (list, tuple)) else result
    segs = []
    for line in lines:
        parts = line.split() if isinstance(line, str) else list(line)
        if len(parts) < 3:
            continue
        m = re.search(r"(\d+)$", str(parts[2]))
        segs.append({"start": num(parts[0]), "end": num(parts[1]), "speaker": int(m.group(1)) if m else 0})
    segs.sort(key=lambda s: s["start"])
    return {"segments": segs}


def main():
    t0 = time.monotonic()
    import torch

    threads = int(os.environ.get("SPEAK_THREADS", "0") or 0)
    if threads > 0:
        torch.set_num_threads(threads)
    import nemo.collections.asr  # noqa: F401  (importen tar några sekunder, gör den innan "ready")

    models = Models(torch)
    send({"ready": True, "import_sec": round(time.monotonic() - t0, 2), "device": str(models.device), "torch": torch.__version__})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            cmd = req.get("cmd", "transcribe")
            t1 = time.monotonic()
            if cmd == "transcribe":
                out = transcribe(models, req)
            elif cmd == "diarize":
                out = diarize(models, req)
            elif cmd == "load":
                models.get(req.get("what", "asr"))
                out = {"load_sec": round(time.monotonic() - t1, 2)}
            else:
                raise ValueError(f"okänt uppdrag: {cmd}")
            send({"id": req.get("id"), "ok": True, "sec": round(time.monotonic() - t1, 3), **out})
        except Exception as e:  # ett trasigt uppdrag ska inte döda arbetaren
            send({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        send({"ready": False, "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
