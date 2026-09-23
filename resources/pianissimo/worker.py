#!/usr/bin/env python3
"""Speak: kör Klang Pianissimo lokalt, precis som modellkortet på Hugging Face beskriver.

    model = ASRModel.from_pretrained(model_name="KlangAI/pianissimo-sv", map_location=device).eval()
    with torch.inference_mode():
        hypotheses = model.transcribe(audio=[path], batch_size=1, return_hypotheses=True, timestamps=True)

Modellen laddas en gång. Sedan läser arbetaren en JSON-rad per uppdrag från stdin och svarar med en
JSON-rad på stdout:

    in:  {"id": 1, "path": "/tmp/x.wav", "timestamps": true}
    ut:  {"id": 1, "ok": true, "text": "...", "segments": [{"start": 0.0, "end": 2.1, "text": "..."}],
          "words": [{"start": 0.0, "end": 0.3, "word": "..."}], "sec": 0.42}

Ljudet ska vara 16 kHz mono WAV (appen konverterar alltid till det). Inget skickas över nätet:
appen startar arbetaren med HF_HUB_OFFLINE=1 och modellen ligger redan i den lokala cachen.
"""

import json
import os
import sys
import time

MODEL = "KlangAI/pianissimo-sv"

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


def main():
    t0 = time.monotonic()
    import torch
    from nemo.collections.asr.models import ASRModel

    threads = int(os.environ.get("SPEAK_THREADS", "0") or 0)
    if threads > 0:
        torch.set_num_threads(threads)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = ASRModel.from_pretrained(model_name=MODEL, map_location=device).eval()
    send({"ready": True, "load_sec": round(time.monotonic() - t0, 2), "device": str(device), "torch": torch.__version__})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = {}
        try:
            req = json.loads(line)
            want_ts = bool(req.get("timestamps"))
            t1 = time.monotonic()
            with torch.inference_mode():
                hypotheses = model.transcribe(
                    audio=[req["path"]],
                    batch_size=1,
                    return_hypotheses=True,
                    timestamps=want_ts,
                )
            h = hypotheses[0]
            if isinstance(h, list):  # vissa NeMo-versioner ger en lista per fil
                h = h[0]
            out = {"id": req.get("id"), "ok": True, "text": getattr(h, "text", str(h)) or "", "sec": round(time.monotonic() - t1, 3)}
            if want_ts:
                ts = getattr(h, "timestamp", None) or {}
                out["segments"] = [
                    {"start": num(s.get("start")), "end": num(s.get("end")), "text": s.get("segment", "")}
                    for s in ts.get("segment", [])
                ]
                out["words"] = [
                    {"start": num(w.get("start")), "end": num(w.get("end")), "word": w.get("word", "")}
                    for w in ts.get("word", [])
                ]
            send(out)
        except Exception as e:  # ett trasigt uppdrag ska inte döda arbetaren
            send({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        send({"ready": False, "error": f"{type(e).__name__}: {e}"})
        sys.exit(1)
