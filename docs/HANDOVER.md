# Handover: Speak.

Fortsätt på appen Speak. i repot substnc/transcription, branch claude/ai-dictation-app-mac-31cco2
(senaste commit 67e3609). Läs README.md, docs/HANDOVER.md och de senaste commit-meddelandena först.

## Om mig
Anthon, MacBook Pro M1 Max 32 GB, macOS 27. Svara kort på svenska i vardagsord.
Krav: allt ljud och all text stannar på datorn. Inga molnsteg (undantag: modellnedladdning en gång).
Arbetssätt: jag testar på min Mac, du felsöker. Ge ALLTID xattr-raden tillsammans med länken till ett nytt bygge:
    xattr -cr "/Applications/Speak.app"
Vid varje nytt bygge: ge Anthon raden som tar bort den gamla versionen och installerar den nya
(förutsätter att artefakten Speak-arm64 är nedladdad och uppackad i Hämtade filer):
    pkill -x Speak; rm -rf "/Applications/Speak.app" "/Applications/sub.stnc® - Speak.app" && ditto -x -k ~/Downloads/Speak-arm64/Speak-*-arm64.zip /Applications && xattr -cr "/Applications/Speak.app" && open "/Applications/Speak.app"
(Appen hette "sub.stnc® - Speak" före 24 sep 2026. Modeller och inställningar ligger kvar i
~/Library/Application Support/sub.stnc® - Speak, appen pekar dit med app.setPath.)

## Läge just nu
Electron-menyradsapp (ikon i Dock, valbart). Klick på Dock-ikonen visar det som pågår.
- Diktering: håll in vänster Option, klistras in med ⌘V. Modell: turbo-metal (whisper.cpp på Metal).
- Mötesläge: mikrofon + datorns ljud med ekoskydd, talare, tidsstämplar, sammanfattning via Ollama,
  export till Obsidian (01_CLAUDE_COWORK eller 02_CLAUDE_PRIVATE/99_inbox). Knappar: Spara till Obsidian,
  Kopiera som text, Börja om.
- Livetext under inspelning (grov), noggrann körning när man stoppar.
- Tre modellval i Inställningar: Diktering (turbo-metal), Möten (kb-large-metal), Livetext (pianissimo-sv).
- Ordlista (namn/fackord) skickas som --prompt till whisper.cpp. Påverkar inte Pianissimo.
- Inspelningar: standard lokalt i Application Support (ingen synk). Anthon har själv valt iCloud Drive/01_CLAUDE_CODE/speak/inspelningar. Raderas efter sparad anteckning
  om inte "Behåll ljudfilerna" är ikryssat. Rester äldre än ett dygn städas vid start.

## Utseende (sub.stnc® light, designfil: claude.ai artifact "Speak i sub.stnc® stil", sidan sub.stnc® light)
- Vitt, svart, grå #818181 i stora rubriker, #5f5f5f i liten text, ytor #ebecef med 16 px rundning,
  knappar som piller, av/på-reglage i stället för kryssrutor. Helvetica Neue (Inter används inte längre).
- Ikonen "röst blir text": en vågform av prickar som rinner ut i en rad. Ritas i kod: src/main/icon-art.js
  (appikon, menyrad, Dock-animation) och src/renderer/icon.js + icon.css (fönstren). npm run icons skriver om
  assets/icon.png och assets/trayTemplate*.png.
- Ikonen rör sig: 'live' (vågen andas) när du dikterar eller spelar in möte, 'type' (raden tänds) när texten tas
  fram. Gäller menyraden, Dock-ikonen, statuspillret och nivåmätaren i mötesläget.
- Fönster: Huvudfönster (src/renderer/home, välkomstsida första gången, inställningen welcomed),
  Om Speak (src/renderer/about, signaturen i assets/signature.png, licenser bakom knappen),
  Inställningar, Mötesläge, statuspill.
- Menyn i menyraden: Öppna Speak, Diktera (tips), Nytt möte, Inställningar, Om Speak, Avsluta.
  Genvägen ⌥⇧D finns kvar men syns inte i menyn.
- Talare visas som runda brickor: J på svart är du, övriga har nummer och egen stil (grå, ring, ljusgrå).

## Motorer
- whisper.cpp (resources/bin/whisper-cli, byggs i CI, Metal). ggml-modeller i models/whisper-cpp-<namn>.
- Klang Pianissimo (KlangAI/pianissimo-sv) körs exakt som modellkortet: Python + PyTorch + NeMo,
  ASRModel.from_pretrained(...).transcribe(..., timestamps=True). Ingen omvandling.
  Python-arbetare: resources/pianissimo/worker.py (JSON över stdin/stdout, laddar modeller vid behov).
  Node-sida: src/engine/pianissimo.js. Installeras med knapp: uv hämtar egen Python 3.11, torch och NeMo
  (låst commit cf724ac på NeMo main, hämtas som arkiv), sedan modellen. Körs med HF_HUB_OFFLINE=1.
  Miljön ligger i models/pianissimo-sv och delas med Nemotron (komponenter 'asr' och 'diar').
- Talare: vid mikrofon + datorns ljud sparas även mote-x.mic.wav och mote-x.sys.wav. Allt som hörs mest i
  mikrofonen blir "Jag", bara datorns ljud delas upp. Uppdelningen görs med NVIDIA Nemotron 3 Diarization
  (nvidia/Nemotron-3-Diarization, SortformerEncLabelModel.diarize, max 8 talare) om den är installerad,
  annars inbyggd (sherpa-onnx: pyannote-segmentering + 3D-Speaker). Med Pianissimo kopplas talare per ord.
  Kod: src/engine/merge.js (channelActivity, combineChannelDiarization, segmentsFromWords),
  src/engine/pipeline.js (speakerTimeline, diarizeAudio, meetingPy, meetingCpp, meeting).
- Sherpa-onnx används även för röstdetektor (VAD) och livetextens uppdelning.

## GitHub Actions
- "Bygg Mac-app": vid varje push. Artefakt Speak-arm64 (dmg).
- "Testa Pianissimo på Mac": installerar Pianissimo + Nemotron på en Apple Silicon-Mac via appens kod och
  kör möte, diktering, livetext, två kanaler och två röster. Körs vid ändringar i motor/arbetare.
- "Konvertera KB-Whisper": manuell, ger ggml-modeller av KB-Whisper.
- Tester lokalt: npm test (32 tester, inga modeller behövs).

## Senaste testresultat (Mac i CI, enkel M1)
- Pianissimo: 59 s ljud på 2,9 s (20× realtid). Diktering 4 s ljud på 1,3 s. Modelladdning cirka 14 s.
- Två kanaler: mikrofonens mening blev "Jag", datorns mening "Talare 1".
- Två tydligt olika röster: Nemotron 2 talare på 0,5 s, inbyggd 2 talare på cirka 2 s, båda rätt ordning.
- Två lika syntetiska röster (samma TTS-modell): båda hittade bara 1. Verkliga möten är otestade.
- Diskutrymme för NeMo-miljön med båda modellerna: cirka 4,5 GB.

## Klangs egna siffror (ordfel, CV / FLEURS / dialekter)
Pianissimo 4,46 / 6,51 / 4,85 %. KB-Whisper large 3,91 / 5,08 / 2,30 %. KB large noggrannare, Pianissimo snabbare.

## Kända begränsningar
- Appen är osignerad (därav xattr). Ingen automatisk uppdatering.
- Nemotron: max 8 talare, NeMo märker modellen som experimentell. Vid fler än 8 används den inbyggda.
- Ordlistan fungerar inte med Pianissimo.
- Livetexten saknar talare.

## Nästa steg
1. Anthon testar Nemotron + två kanaler på riktiga videomöten. Blir talarna fortfarande fel: stäng av funktionen.
2. Mät ett riktigt 18-minutersmöte på M1 Max: KB large mot Pianissimo, tid och kvalitet.
3. Bestäm modell för Möten utifrån 2 (Pianissimo snabbast, KB large noggrannast).
4. Eventuellt: talare i livetexten (kanal = Jag/Andra), ordlista för Pianissimo, kortare dikteringsfördröjning.
