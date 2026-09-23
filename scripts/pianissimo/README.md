# Pianissimo till Speak

[Klang Pianissimo](https://huggingface.co/KlangAI/pianissimo-sv) är en öppen svensk taligenkänningsmodell
(finjusterad NVIDIA Parakeet v3, 600 miljoner parametrar, CC BY 4.0). Här görs den om till sherpa-onnx-format
så att Speak kan köra den lokalt, utan moln. Allt sker i GitHub-jobbet `.github/workflows/convert-pianissimo.yml`.

Steg i jobbet:
- Licensen i modellkortet kontrolleras (`check_license.py`).
- Modellen laddas med NeMo och exporteras till encoder/decoder/joiner i ONNX, i full precision och int8
  (`export_onnx.py`, bygger på sherpa-onnx:s skript för parakeet-tdt-0.6b-v3). Går modellens lokala attention
  inte att exportera byts den automatiskt till full attention.
- `bpe.vocab` skapas så att Speaks ordlista fungerar (hotwords).
- Resultatet testas genom appens egen motor på svenskt tal från lokal TTS: möte, möte med ordlista och livetext
  (`test_model.js`).

Artefakter: `pianissimo-sv` (int8, cirka 0,7 GB, rekommenderad) och `pianissimo-sv-fp32` (full precision, cirka 2,4 GB).
Importera .tar.bz2-filen i Speak under Inställningar → Importera modell.

Obs: NeMo laddar modellfilen med PyTorch. Det sker bara i byggjobbet, aldrig i appen, som bara läser ONNX-filerna.
