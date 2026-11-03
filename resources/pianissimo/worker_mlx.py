#!/usr/bin/env python3
"""Speak: kör Klang Pianissimo för Mac (MLX) lokalt, som modellkortet beskriver:

    path = snapshot_download("KlangAI/pianissimo-sv-mlx-8bit")
    sys.path.append(path)
    import pianissimo_mlx
    model = pianissimo_mlx.load(path)
    result = pianissimo_mlx.transcribe(model, audio, boost=["Klang AI", "Pianissimo"])

Ingen PyTorch och ingen NeMo: modellen körs på Macens grafikkrets med Apples MLX. Samma protokoll som
worker.py (en JSON-rad in per uppdrag, en JSON-rad ut), så att appen kan använda båda på samma sätt:

    {"id": 1, "cmd": "transcribe", "path": "/tmp/x.wav", "timestamps": true, "boost": ["Anthon"]}
      -> {"id": 1, "ok": true, "text": "...", "segments": [...], "words": [...], "sec": 0.4}
    {"id": 2, "cmd": "load", "what": "asr"}
      -> {"id": 2, "ok": true, "load_sec": 1.2}

Ljudet ska vara 16 kHz mono 16-bitars WAV (det appen skriver). Inget skickas över nätet: appen startar
arbetaren med HF_HUB_OFFLINE=1 och modellen ligger redan i den lokala cachen.
"""

import json
import os
import sys
import time
import wave

# Allt som biblioteken skriver till stdout flyttas till stderr (loggen), så att stdout bara har våra svar.
_out = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8")
os.dup2(2, 1)
sys.stdout = sys.stderr

REPO = os.environ.get("SPEAK_MLX_REPO", "KlangAI/pianissimo-sv-mlx-8bit")
REVISION = os.environ.get("SPEAK_MLX_REVISION") or None
PAD_SEC = 0.3


def send(obj):
    _out.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _out.flush()


def read_wav(path, np):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise ValueError("ljudet ska vara 16-bitars mono WAV")
        data = w.readframes(w.getnframes())
    return np.frombuffer(data, np.int16).astype(np.float32) / 32768.0


def words_from(sentences):
    # Modellen ger ordbitar (tokens). Ett nytt ord börjar där biten börjar med mellanslag.
    words = []
    for s in sentences:
        for t in s.tokens:
            text = t.text
            if not words or text.startswith(" "):
                if text.strip():
                    words.append({"start": t.start, "end": t.end, "word": text.strip()})
            else:
                words[-1]["word"] += text
                words[-1]["end"] = t.end
    return words


class Model:
    def __init__(self, mx):
        self.mx = mx
        self.model = None
        self.lib = None

    def get(self):
        if self.model is None:
            t0 = time.monotonic()
            from huggingface_hub import snapshot_download
            path = snapshot_download(REPO, revision=REVISION)
            sys.path.insert(0, path)
            import pianissimo_mlx
            self.lib = pianissimo_mlx
            self.model = pianissimo_mlx.load(path)
            print(f"[arbetare] {REPO} laddad på {time.monotonic() - t0:.1f} s", file=sys.stderr)
        return self.model


def transcribe(m, np, req):
    audio = read_wav(req["path"], np)
    boost = [b for b in (req.get("boost") or []) if isinstance(b, str) and b.strip()] or None
    model = m.get()
    if len(audio) < 1600:  # under en tiondels sekund: inget att höra
        return {"text": "", "segments": [], "words": []}
    # Modellen tappar gärna första ordet när ljudet börjar mitt i tal. En kort tystnad före och
    # efter hjälper; tiderna flyttas tillbaka efteråt.
    pad = np.zeros(int(PAD_SEC * 16000), np.float32)
    result = m.lib.transcribe(model, np.concatenate([pad, audio, pad]), boost=boost)
    out = {"text": (result.text or "").strip()}
    if req.get("timestamps"):
        end = len(audio) / 16000
        at = lambda x: min(end, max(0.0, x - PAD_SEC))  # noqa: E731
        out["segments"] = [{"start": at(s.start), "end": at(s.end), "text": s.text.strip()} for s in result.sentences]
        out["words"] = [{**w, "start": at(w["start"]), "end": at(w["end"])} for w in words_from(result.sentences)]
    return out


def main():
    t0 = time.monotonic()
    import mlx.core as mx
    import numpy as np

    # Grafikkretsen när den finns. Annars (t.ex. en virtuell Mac) processorn.
    device = "gpu"
    if os.environ.get("SPEAK_DEVICE") == "cpu" or not mx.metal.is_available():
        mx.set_default_device(mx.cpu)
        device = "cpu"
    import parakeet_mlx  # noqa: F401  (importen tar en stund, gör den innan "ready")

    m = Model(mx)
    send({"ready": True, "import_sec": round(time.monotonic() - t0, 2), "device": device, "torch": f"mlx {mx.__version__}"})

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
                out = transcribe(m, np, req)
            elif cmd == "load":
                if req.get("what", "asr") != "asr":
                    raise ValueError("MLX-arbetaren har bara taligenkänning")
                m.get()
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
