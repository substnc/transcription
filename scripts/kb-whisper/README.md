# KB-Whisper till Speak

Kungliga bibliotekets svensktränade whisper (KBLab/kb-whisper-*) konverteras här till det
ONNX-format som appens motor (sherpa-onnx) kör. Allt sker i ett GitHub Actions-jobb, se
`.github/workflows/convert-kb-whisper.yml`.

Säkerhet:
- Bara safetensors läses (inga pickle-filer från nätet). Ingen fjärrkod (`trust_remote_code=False`).
- Licensen i modellkortet kontrolleras innan något körs (`verify_license.py`).
- Nyckelmappningen är inversen av transformers egna konverterare och verifieras numeriskt
  (`test_equivalence.py`, max avvikelse 0.0 på en testmodell).
- Resultatet testas i sherpa-onnx innan det paketeras.

Kör jobbet under Actions → "Konvertera KB-Whisper", välj storlek, ladda ner artefakten och
importera mappen i Speak under Inställningar → Taligenkänning → "Importera modell".
