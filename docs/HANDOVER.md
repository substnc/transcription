# Handover: Speak.

Fortsätt på appen Speak. i repot substnc/transcription, branch claude/ai-dictation-app-mac-31cco2.
Läs README.md, docs/HANDOVER.md och de senaste commit-meddelandena först.

## Om mig
Anthon, MacBook Pro M1 Max 32 GB, macOS 27. Svara kort på svenska i vardagsord.
Krav: allt ljud och all text stannar på datorn. Inga molnsteg (undantag: modellnedladdning en gång).
Arbetssätt: jag testar på min Mac, du felsöker. Vill se en skiss i designfilen innan större utseendeändringar.

Vid varje nytt bygge: ge länken till bygget och raden som tar bort den gamla versionen och installerar den nya
(artefakten Speak-arm64 nedladdad och uppackad i Hämtade filer):
    pkill -x Speak; rm -rf "/Applications/Speak.app" "/Applications/sub.stnc® - Speak.app" && ditto -x -k ~/Downloads/Speak-arm64/Speak-*-arm64.zip /Applications && xattr -cr "/Applications/Speak.app" && open "/Applications/Speak.app"
Ge också alltid den korta raden separat:
    xattr -cr "/Applications/Speak.app"

## Namnet
Appen heter "Speak." (filen Speak.app, CFBundleDisplayName "Speak."). Före 24 sep 2026: "sub.stnc® - Speak".
CFBundleName får INTE ändras från productName ("Speak"): Electron letar då efter fel hjälpapp och kraschar
("Unable to find helper app"). Modeller och inställningar ligger kvar i ~/Library/Application Support/sub.stnc® - Speak,
main.js pekar dit med app.setPath före single-instance-låset.

## Läge just nu
Electron-menyradsapp med ikon i Dock (valbart).
- Huvudfönster (src/renderer/home): Diktering och Möten. Välkomstsida första gången (inställningen welcomed).
  Inställningar öppnas i samma fönster med "← Tillbaka" uppe till vänster (settings.html?from=home).
- Diktering: håll in vänster Control (Anthons val), klistras in med ⌘V. turbo-metal (whisper.cpp på Metal).
  Statuspillret: Lyssnar…, Transkriberar…, bock + Inklistrat.
- Mötesläge: mikrofon + datorns ljud, livetext med Pianissimo, talare, sammanfattning via Ollama, Obsidian-export.
- Inställningen "När mötet stoppas" (meetingSource):
  - 'live' (standard): livetexten blir mötets text. Talare läggs på, sedan korrläser den lokala språkmodellen
    transkriptet (10 rader i taget med 3 raders sammanhang, mötets titel och ordlistan) och rättar hörfel,
    sedan sammanfattning. Ingen ny transkribering. Kod: main.js meetingFromLive, server.js meetingFromLive,
    llm.js correctLines, summarize.js CORRECT_SYSTEM.
  - 'full': hela mötet körs om med modellen under Möten.
  - Uppladdade filer körs alltid 'full'. En egen mote-….wav med .mic/.sys bredvid körs med kanalerna.
- Långa möten (>15 min) delas i stycken om cirka 10 min i en tyst stund (pipeline.js splitLong), både för
  whisper.cpp och Pianissimo. whisper-cli har en vakt: står den still 5 min avbryts den, stycket körs om
  enklare (greedy), och fastnar det igen står en markering i texten i stället. Förlopp i procent.
- Sammanfattning: Ollama med num_ctx 32768. Långa transkript (>60 000 tecken) sammanfattas del för del och
  sedan som helhet (llm.js summarize).
- Pianissimo och Nemotron kör på Macens grafikkrets (MPS) med PYTORCH_ENABLE_MPS_FALLBACK=1. Fungerar något
  inte på MPS byter modellen till cpu och kör om. SPEAK_DEVICE=cpu tvingar processorn. OTESTAT på Anthons Mac:
  kolla engine.log efter "arbetaren redo … mps".
- Modellval: Diktering turbo-metal, Möten kb-large-metal (Anthon kan ha bytt till Pianissimo), Livetext pianissimo-sv.
- Inspelningar: standard lokalt i Application Support (ingen synk). Anthon har själv valt
  iCloud Drive/01_CLAUDE_CODE/speak/inspelningar. Raderas efter sparad anteckning om inte "Behåll ljudfilerna".
  Rester äldre än ett dygn städas vid start.

## Talare som byter nummer mitt i mötet (incheckat 25 sep 2026, väntar på Anthons test)
Problem (Anthon): samma person blir plötsligt "Talare 7" i stället för "Talare 1" i långa möten.
- merge.js mergeSimilarSpeakers: röstavtryck per talare, slår ihop talare som låter lika (cosinus > 0,6),
  eller tills antalet stämmer med angivet antal talare. Mikrofonen ("me") rörs aldrig.
- pipeline.js fixSpeakerDrift: röstavtryck (3D-Speaker via sherpa SpeakerEmbeddingExtractor) från varje talares
  längsta stycken, högst 60 s. Anropas sist i speakerTimeline. Loggrad i engine.log: "röstjämförelse: slog ihop …".
- meeting.js: samma namn på två talare i resultatet slår ihop dem. Hjälptext under talarna.
- test/speaker-drift.test.js: tre tester.
- Provat på riktigt ljud (sherpas 0-four-speakers-zh.wav, 4 talare): klustringen delade upp i 6–8 talare,
  röstjämförelsen slog ihop till rätt 4, även utan angivet antal.
Att göra: Anthon testar på ett långt möte. Slås olika personer ihop, höj tröskeln (0,6). Idé för senare:
röstprofiler (spela in återkommande personer en gång, känn igen dem med namn).

## Video under mötet (incheckat 25 sep 2026, väntar på Anthons test)
Problem (Anthon): videoklipp som spelas upp under mötet kommer med i transkriptet.
- Språkmodellen letar efter klipp efter korrläsningen (llm.js findClips, summarize.js ASIDE_SYSTEM): 120 rader
  i taget med 20 raders överlapp, svar som radnummer. Raderna får aside = klippets nummer (server.js findClips).
  Körs i main.js clipsAndSummary för både livetext och full körning. Loggrad: "troligen video: rad …".
- Sammanfattningen tar inte med aside-rader. Inget tas bort utan att Anthon trycker.
- Resultatet (meeting.js renderSegments): vit ruta "Troligen video" med Ta bort / Behåll, och egen markering
  med rundeln framför varje rad (shift-klick = allt däremellan), "Ta bort N rader" / Avbryt. Borttagning gör
  om sammanfattningen. Skisser: designfilen, "Resultat: modellen hittar video" och "Resultat: markera och ta bort".
- Svaghet: sägs inget högt om klippet kan modellen missa det. Idé för senare: knapp "Video spelas" under inspelning.

## Genomgång av hela appen (26 sep 2026)
Fixat: hallucinationsfiltret tog bort långa talartur med "www."/"textning"/stora tal (gäller nu bara korta
stycken), kraschad inspelning gav tomt möte (readWav läser allt, repairWav lagar huvudet vid uppladdning),
diktering under mötesbearbetning bytte mötets modell, språkval engelska/båda ignorerades med livetext (kör nu
om hela mötet), sparad anteckning kunde radera uppladdade originalfiler (raderar bara i inspelningsmappen),
städningen vid start raderade alla .wav i mappen (nu bara mote-/upload-), "Ladda upp fil" under inspelning tog
över fönstret.
Kvar att göra (större, motorn vid krasch):
- Livetexten tappar resten av mötet om motorn startar om mitt i (main.js pumpLive, server.js liveFeed):
  markera live.failed och kör transcribeMeeting i stället.
- Kraschar det dolda inspelningsfönstret fortsätter tiduret men inget spelas in (main.js ~606).
- engine-client.js: timeout vid start dödar inte processen, init skickas inte efter omstart, exit-hanteraren
  registreras efter firstRunCheck.

## Diktering: snabbhet och urklipp (26 sep 2026)
- whisper-server (whispercpp.js WhisperServer, pipeline.js dictationServer/warmDictation) håller
  dikteringsmodellen laddad. Startas vid init, bara 127.0.0.1, reserv whisper-cli. engine.log:
  "whisper-server redo på …" och "diktering (whisper-server): X s ljud på Y s". Byggs i CI.
- Urklipp (paste.js): sparar text, html, rtf, bild och kopierad fil, lägger tillbaka efter 700 ms.
  ORSAK HITTAD 27 sep: Electron 44:s clipboard är asynkront (readText/read/write/writeText ger löften).
  Gamla koden jämförde ett löfte med texten, så urklippet lades aldrig tillbaka. Nu await överallt, read() +
  ClipboardItem sparar alla typer. Provat i Electron (Linux). logs/main.log: "[urklipp] före: … efter ⌘V: …".
- Idé om det inte räcker: skriva texten direkt med tangenthändelser (CGEvent) utan urklipp.

## Ett fönster (byggt 27 sep 2026)
windows.createMain: BaseWindow med två WebContentsView (home, meeting), en syns åt gången, båda lever kvar.
Inställningar laddas i home-vyn (?from=home). Mötessidan har ← Tillbaka och rapporterar sitt läge
(meeting:status: idle/recording/processing/done) till main, som skickar det till huvudsidan (meeting:state)
och bygger om menyn (● Möte spelas in, Visa mötet, Stoppa och transkribera). Stoppa från huvudsidan klickar
btnStop i mötesvyn. Röda knappen gömmer fönstret. Avsluta mitt i ett möte eller med osparat resultat frågar
först. Om Speak är fortfarande ett eget litet fönster. Provat i Electron under Linux (skärmbilder), inte på Mac:
kolla att fönstret går att dra i överkanten (-webkit-app-region i WebContentsView).

## Två motorer (27 sep 2026)
Mötesmotorn (engine.log) kan vara låst i minuter: sherpas talaruppdelning och röstavtryck körs synkront på långa
möten. Därför en egen dikteringsmotor (dictation.log, EngineClient 'speak-dictation', init role 'dictation'):
dictate, status, llmStatus, engineInfo, warmup går dit. Bara den startar whisper-server. Huvudsidan visas
direkt och väntar högst 2 s på status (home.js within). Tidigare: vit sida och hängande diktering under ett
2 h-möte. Idé för senare: flytta talaruppdelningen till en worker_thread så att förloppet också rör sig.

## Frågor efter mötet (byggt 29 sep 2026)
- Nytt möte har fältet "Vad handlar mötet om, och vilka är med?" (about). Går till korrläsningen och
  videosökningen som ämne, och till namngissningen (namn där räknas direkt).
- src/engine/questions.js (utan språkmodell, test/questions.test.js): namn ur tilltal ("Som du sa, Per")
  + vem som svarar inom 3 repliker/20 s, "jag heter X". Två träffar och 75 % av rösterna = namnet sätts
  direkt (autoNames), annars fråga. Samma person: pipeline.fixSpeakerDrift sparar par med röstlikhet
  0,45–0,6 (merge.js nearSpeakers), mappas till Talare N i similarLabels. Ord: korrläsningens ändringar
  (server.js r.corrections) där nya ordet har stor bokstav eller siffra.
- main.js addQuestions efter sammanfattningen. meeting.js: sektion "questions" (Innan du läser), visas bara
  med fler än 2 talare. Kort med repliker från hela mötet och uppspelning av mötets ljudfil (CSP media-src
  file:). Ja slår ihop / sätter namn / lägger ord i ordlistan, Nej på ord återställer. "Visa texten direkt",
  sedan länken "N frågor kvar" i resultatet. Sammanfattningen görs om om något ändrats.
- Provat i Electron (Linux) med påhittat möte och riktigt ljud. Inte provat på Mac.

## Deltagare (29 sep 2026)
Anthon: ett möte med två personer blev fyra talare. Nytt möte har "Vilka är med? Utom du" (ersätter
Antal talare; ett tal går också). speakerCount = namn + 1 (du), utom med "Bara datorns ljud". Antalet låser
talaruppdelningen och fixSpeakerDrift slår ihop överskottet. En person i datorns ljud (videomöte på två) =
ingen uppdelning alls (pipeline speakerTimeline count===1). questions.js: bara deltagarnas namn räknas; en
talare och ett namn kvar = namnet sätts direkt; annars kortet "Vem är Talare 2?" (type pick) med namnen som
knappar, gissning först. Provat i Electron (Linux), inte på Mac.

## Långsam första diktering efter omstart (29 okt 2026)
Orsaker: llmDictation är på som standard, och Ollama laddade modellen (flera GB) vid första dikteringen och
släppte den igen efter 5 minuter (Ollamas standard). Dessutom förbereder Metal sina beräkningar vid första
anropet till whisper-server. Rättat: keep_alive 30m på alla Ollama-anrop, llm.warm() vid dikteringsmotorns start,
whisper-server kör en sekund tystnad direkt efter start, och dikteringsmotorn startas före mötesmotorn.
dictation.log: "språkmodellen … laddad på", "whisper-server uppvärmd på", "språkmodellen städade på".

## Nytt från Klang (okt 2026), inte inbyggt
- Pianissimo finns som MLX (Apple-grafikkretsen) och ONNX, även kvantiserade (28 sep). MLX 8-bit: 759 MB,
  ordfel 4,51 % (CV) mot 4,46 % original, 151× realtid på M5 Pro. Kan ersätta PyTorch/NeMo-arbetaren
  (2,5 GB modell + stor installation). ONNX int8 660 MB, 74× på Mac (CPU), via onnx-asr.
- Egen ordlista för Pianissimo (1 okt), även i MLX och ONNX. Alpha 1.0: 39 % → 64 % rätt stavade namn.
  Skiftlägeskänslig. Då kan Speaks ordlista användas med Pianissimo också.
- whisper.cpp: README nämner ANEForge (encodern på Neural Engine), ej verifierat.

## Utseende (sub.stnc® light, designfil https://claude.ai/artifact/6tMosir28LYzsB4kAJAxU2, sidan "sub.stnc® light")
- Vitt, svart, grå #818181 i stora rubriker, #5f5f5f i liten text, ytor #ebecef med 16 px rundning,
  knappar som piller, av/på-reglage. Helvetica Neue.
- Ikonen "röst blir text": vågform av prickar som rinner ut i en rad. src/main/icon-art.js (appikon, menyrad,
  Dock-animation), src/renderer/icon.js + icon.css (fönstren). npm run icons skriver om assets/icon.png och
  assets/trayTemplate*.png.
- Ikonen rör sig: 'live' när du dikterar eller spelar in, 'type' när texten tas fram. Menyrad, Dock, statuspill,
  nivåmätaren i mötesläget.
- Om Speak (src/renderer/about): prickikonen, "Speak.", signaturen (assets/signature.png, SVART på genomskinligt;
  designsystemets anteckning om vit stämmer inte), "Made by Anthon Bäckström", knappen Licenses med licenslista och
  versionsnummer.
- Menyn i menyraden: Öppna Speak, Diktera (tips), Nytt möte, Inställningar, Om Speak, Avsluta. ⌥⇧D finns kvar men syns inte.
- Talare som runda brickor: J på svart är du, övriga har nummer och egen stil.
- Oanvända filer kvar (fick inte raderas i sessionen): src/renderer/fonts/ (Inter), assets/substnc-logo.svg.

## Motorer
- whisper.cpp (resources/bin/whisper-cli, byggs i CI, Metal). ggml-modeller i models/whisper-cpp-<namn>.
- Klang Pianissimo körs som modellkortet: Python + PyTorch + NeMo (resources/pianissimo/worker.py,
  src/engine/pianissimo.js). Installeras med knapp (uv, Python 3.11, torch, NeMo låst commit cf724ac).
  HF_HUB_OFFLINE=1. Miljön i models/pianissimo-sv, delas med Nemotron.
- Talare: kanaler (mote-x.mic.wav = "Jag", mote-x.sys.wav delas upp) + NVIDIA Nemotron 3 Diarization (max 8),
  annars inbyggd (sherpa: pyannote + 3D-Speaker). Med Pianissimo kopplas talare per ord.
- Sherpa-onnx för röstdetektor (VAD) och livetextens uppdelning.

## GitHub Actions
- "Bygg Mac-app": vid varje push, artefakt Speak-arm64. Tar cirka 2 min.
- "Testa Pianissimo på Mac": vid ändringar i motor/arbetare, cirka 20 min. Körningen för MPS-ändringen
  (commit 0390673) var inte färdig vid överlämningen: kolla resultatet.
- "Konvertera KB-Whisper": manuell.
- Tester lokalt: npm test (43 tester, inga modeller behövs).

## Senaste testresultat (Mac i CI, enkel M1, före MPS)
- Pianissimo: 59 s ljud på 2,9 s (20× realtid, på processorn). Klangs "en timme på en sekund" gäller stark GPU.
- Två kanaler och två tydligt olika röster: rätt. Lika röster: slås ihop.
- Riktiga möten: talare byter nummer i långa möten (åtgärdat, väntar på test).

## Klangs egna siffror (ordfel, CV / FLEURS / dialekter)
Pianissimo 4,46 / 6,51 / 4,85 %. KB-Whisper large 3,91 / 5,08 / 2,30 %. Pianissimo förstår bara svenska.

## Övrigt från sessionen
- LinkedIn-inlägg och bild (sub.stnc® Dark) gjorda. Mejl till Klang (team@klang.ai) om att visa Speak. på
  deras Pianissimo-sida är skrivet, Anthon skickar själv.
- Wispr Flow bearbetar ljud i molnet i USA (kontrollerat), Speak. gör allt lokalt.

## Nästa steg
1. Anthon testar talar-ihopslagningen på ett långt möte (se "Talare som byter nummer").
1b. Anthon testar videorutan på mötet med två videoklipp (se "Video under mötet").
2. Anthon testar MPS: är Pianissimo snabbare, står "mps" i loggen?
3. Anthon testar korrläsningen på ett riktigt möte. Överväg större Ollama-modell (t.ex. qwen2.5:14b) om svenskan brister.
4. Eventuellt: röstprofiler för återkommande personer, talare i livetexten, ordlista för Pianissimo.

## Pianissimo för Mac (MLX) (3 nov 2026)

Nytt modellval `pianissimo-mlx` i Inställningar. Klangs 8-bitarsversion (`KlangAI/pianissimo-sv-mlx-8bit`,
låst till revision 7b4d528) körs på grafikkretsen med Apples MLX, utan PyTorch och NeMo. Installationen
(uv, egen Python, `parakeet-mlx==0.5.2`, modellen) tar cirka 1,4 GB på disk. Arbetaren är
`resources/pianissimo/worker_mlx.py` och talar samma protokoll som NeMo-arbetaren, så möten, diktering och
livetext fungerar likadant. Ordlistan skickas med som `boost` (förstärkta stavningar, högst 200 ord).

Mätt i CI (virtuell Mac, svagare grafik än en riktig M-dator): modellen laddas på 1–4 s, en diktering på
4 s tar 0,2–0,3 s, ett möte på 3 minuter tar 5 s. Testet: `.github/workflows/test-pianissimo-mlx.yml`.
Den gamla `pianissimo-sv` (NeMo) och Nemotron 3 Diarization finns kvar; Nemotron kräver fortfarande NeMo.

## Inställningar som sidopanel och mjuka animeringar (4 nov 2026)

Inställningarna följer förslag B i designfilen: flikarna Diktering, Möten, Ordlista, Behörigheter (prick när
något saknas) och Avancerat. Modellvalen är borta ur gränssnittet: med Pianissimo för Mac installerad väljer
`chooseModels` i `settings.js` själv (svenska: MLX överallt; "Svenska och engelska": whisper turbo för
diktering, MLX för möten; engelska: turbo). Talare separeras alltid. Ordlistan visas som lappar men sparas som
förut (ett ord per rad i `vocabulary`). Borttaget ur gränssnittet: modellslotarna, Importera modell, valet av
talarmodell, "Separera talare", "Visa i Dock" och "Öppna mötesläge". Inställningarna finns kvar i filen.

Animeringar i `shared.css`: bara opacitet och förflyttning, under en halv sekund, och avstängda när
"Minska rörelse" är på i macOS. Dikteringsrutan (overlay) är orörd.
