# sub.stnc® - Speak

Lokal AI-diktering och mötestranskribering för Mac, som en app i menyraden.
Håll in en tangent, prata, släpp. Texten städas och klistras in där markören står.
Klarar svenska och engelska, även blandat i samma mening.

**Inget ljud och ingen text lämnar datorn.** Taligenkänning, talarseparering och
sammanfattning körs lokalt. Den enda nätverkstrafiken är när du själv laddar ner
modellfiler första gången.

## Vad appen gör

**Diktering**
- Håll in höger ⌥ (Option) och prata. Släpp, så klistras texten in med ⌘V.
- Tangent och beteende (håll in eller tryck av/på) väljs i Inställningar. Genvägen ⌥⇧D fungerar alltid som av/på.
- Texten städas: tvekljud bort, skiljetecken och versaler fixas. Med Ollama installerat gör en lokal språkmodell jobbet, annars enkla regler.
- Röstkommandon: "ny rad", "nytt stycke", "new line", "new paragraph".
- Ordlista: skriv in namn och facktermer i Inställningar (ett per rad). De skickas med till taligenkänningen som ledtråd så att de stavas rätt, i både diktering och möten (whisper; påverkar inte Pianissimo).

**Mötesläge**
- Spela in via mikrofonen, plus datorns eget ljud i videomöten (macOS 14.2+), eller ladda upp en ljud- eller videofil (mp3, m4a, wav, mp4 med flera).
- Innan inspelning visas en påminnelse om samtycke. Du måste bocka i att alla deltagare fått veta och sagt ja.
- Hela mötet transkriberas, talare märks upp med tidsstämplar, och en sammanfattning med beslut och att-göra skapas.
- Du kan döpa om talare och redigera allt innan du sparar.
- Sparas som Obsidian-Markdown med frontmatter (titel, datum, längd, talare, språk, taggar, samtycke) till en av dina inkorgar:
  - `…/iCloud~md~obsidian/Documents/01_CLAUDE_COWORK/99_inbox`
  - `…/iCloud~md~obsidian/Documents/02_CLAUDE_PRIVATE/99_inbox`
  - eller valfri annan mapp.

## Så fungerar det under huven

| Del | Teknik | Var det körs |
|---|---|---|
| Taligenkänning | Whisper via [whisper.cpp](https://github.com/ggml-org/whisper.cpp) på grafikkretsen (Metal), eller [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) på CPU | På datorn |
| Röstdetektor | Silero VAD | På datorn |
| Talarseparering | Kanaler (mikrofon = du) + NVIDIA Nemotron 3 Diarization, eller pyannote segmentation 3.0 + 3D-Speaker | På datorn |
| Textstädning och sammanfattning | Ollama (valfritt), annars regler | På datorn (127.0.0.1) |
| Ljudkonvertering | ffmpeg (medföljer) | På datorn |
| Håll-in-tangent | uiohook | På datorn |
| Inklistring | Urklipp + ⌘V via System Events | På datorn |

Appen vägrar prata med en språkmodell som inte ligger på localhost. Fönstren har
Content-Security-Policy som blockerar all nätverkstrafik.

## Kom igång

Kräver macOS 13 eller senare och Node 20 eller senare för att bygga.

```bash
npm install
npm run models          # laddar ner talarmodellerna + turbo (ca 1,7 GB)
npm start
```

Första gången ber macOS om tre behörigheter. Alla behövs:

1. **Mikrofon**: för att höra dig.
2. **Tillgänglighet**: för att kunna klistra in med ⌘V.
3. **Inmatningsövervakning**: för att märka när du håller in tangenten.

Om håll-in-tangenten inte reagerar: öppna Systeminställningar → Integritet och säkerhet,
lägg till Speak under både Tillgänglighet och Inmatningsövervakning, och starta om appen.

### Modeller

Alla körs av whisper.cpp på grafikkretsen (Metal). Två modeller räcker: en snabb för diktering
och en noggrann för möten. Båda klarar svenska och engelska och väljs i Inställningar.

| Modell | Storlek | Används för |
|---|---|---|
| turbo | 1,6 GB | Diktering. OpenAI large-v3 turbo, snabb. Laddas ner automatiskt. |
| KB-Whisper large | 3 GB | Möten. Noggrannast på svenska. Importeras från konverteringsjobbet. |

Konverteringsjobbet kan även ge en komprimerad variant (`-metal-q5`) och medium; importerar du en
sådan dyker den upp i listan och kan väljas för diktering eller möten.

**Klang Pianissimo** (öppen svensk modell, CC BY 4.0) körs precis som modellkortet på
[Hugging Face](https://huggingface.co/KlangAI/pianissimo-sv) beskriver: Python med PyTorch och `nemo_toolkit[asr]`,
`ASRModel.from_pretrained("KlangAI/pianissimo-sv")` och `model.transcribe(..., timestamps=True)`, med modellens egen
lokala attention. Ingen omvandling. Installeras med en knapp i Inställningar: appen hämtar uv, en egen Python 3.11,
PyTorch, NeMo och modellen (cirka 4,5 GB, en gång). Därefter körs den utan nät (`HF_HUB_OFFLINE=1`) i en egen
Python-process som håller modellen laddad (`resources/pianissimo/worker.py`). Ordlistan påverkar inte Pianissimo.
Jobbet Actions → "Testa Pianissimo på Mac" installerar och provkör den på en Apple Silicon-Mac.

Klangs egna mätningar (ordfel, lägre är bättre): Pianissimo 4,46 / 6,51 / 4,85 %, KB-Whisper large
3,91 / 5,08 / 2,30 % (Common Voice / FLEURS / dialekter). KB large är alltså noggrannare, Pianissimo mycket snabbare.

**Talare:** vid videomöten spelas mikrofonen och datorns ljud in var för sig (`mote-x.mic.wav`, `mote-x.sys.wav`,
bredvid den vanliga filen). Allt som hörs mest i mikrofonen blir "Jag", och bara datorns ljud delas upp i talare.
Uppdelningen görs med **NVIDIA Nemotron 3 Diarization** (open weights, OpenMDW-licens, max 8 talare) när den är
installerad, precis som modellkortet beskriver: `SortformerEncLabelModel.from_pretrained("nvidia/Nemotron-3-Diarization")`
och `diarize(...)`. Den installeras med en knapp under Mötesläge och delar Python-miljö med Pianissimo. Annars,
eller vid fler än 8 talare, används den inbyggda (pyannote-segmentering och röstavtryck via sherpa-onnx). Med
Pianissimo kopplas talare till varje ord, så att ett talarbyte mitt i en mening hamnar rätt.

**Livetext:** medan ett möte spelas in visas en grov text som växer fram. När du stoppar görs den noggranna
körningen med modellen under "Möten", med talare och tidsstämplar. Modellen för livetext väljs i Inställningar
(eller "Av").

Talarmodellerna (röstdetektor, talarsegmentering, röstavtryck, 50 MB) laddas ner med en knapp.

Raden **Motor** i Inställningar visar vad de valda modellerna körs med: "Metal" är rätt.
Står det att whisper-cli saknas är appen byggd utan binären; hämta ett nyare bygge. Efter ett möte
visas tiden det tog och hur många gånger snabbare än realtid det gick, både i mötesfönstret och i loggen
(Inställningar → Visa loggar, sök på `[motor] klart`).

**KB-Whisper** konverteras av ett GitHub-jobb: Actions → "Konvertera KB-Whisper" → välj storlek →
ladda ner artefakten `kb-whisper-<storlek>-metal` (eller `-metal-q5`) → Inställningar →
"Importera modell". Detaljer och säkerhetskontroller i `scripts/kb-whisper/README.md`.

### Ollama (valfritt men rekommenderat)

Installera [Ollama](https://ollama.com) och hämta en modell, till exempel:

```bash
ollama pull qwen2.5:7b
```

Speak hittar den automatiskt och använder den för att städa dikterad text och
sammanfatta möten. Utan Ollama används enkla regler, och sammanfattningen märks
som automatisk grovsammanfattning.

## Färdig app (dmg)

Varje push bygger appen på GitHubs Mac-maskiner. Hämta den så här:

1. Gå till fliken **Actions** i repot och öppna det senaste gröna bygget.
2. Ladda ner artefakten **Speak-arm64** längst ner på sidan (kräver att du är inloggad).
3. Packa upp, öppna dmg:n och dra Speak till Program.

Den är byggd för Apple Silicon (M1 och senare). Kör sedan en gång i Terminal:

```bash
xattr -cr "/Applications/sub.stnc® - Speak.app"
```

Det behövs för att appen är osignerad. Annars säger macOS att den är skadad.
Sedan: starta appen, gå till Inställningar i menyraden, ladda ner modellerna och
ge behörigheterna.

Bygga själv på en Mac: `npm run dist` ger en dmg i `dist/`.

## Utveckling

```bash
npm test                 # enhetstester (rena funktioner, inga modeller behövs)

# Fullt integrationstest med riktiga modeller:
DIKTERA_TEST_MODELS=/sökväg/till/modeller DIKTERA_TEST_WAV=/sökväg/test.wav npm test

# Röktest som startar hela Electron-appen, öppnar fönstren och kör en transkribering:
DIKTERA_SMOKE=1 DIKTERA_MODELS_DIR=/sökväg/till/modeller DIKTERA_TEST_WAV=/sökväg/test.wav npm start
```

Struktur:

```
src/engine/     ren Node: modeller, ljud, whisper-pipeline, Pianissimo-arbetare, städning, sammanfattning, markdown
resources/      whisper-cli (byggs i CI) och Pianissimo-arbetaren i Python
src/main/       Electron: menyrad, tangentlyssning, inklistring, fönster, IPC
src/renderer/   fönster: osynlig mikrofon, statuspill, mötesläge, inställningar
scripts/        nedladdning av modeller, ikoner
test/           node:test
```

Motorn körs i en egen process så att appen aldrig hänger under transkribering.

## Kända begränsningar

- Datorns ljud i möten kräver macOS 14.2 eller senare och behörigheten Skärminspelning. På äldre system spelas bara mikrofonen in.
- Whisper ger inga ordvisa tidsstämplar. Tidsstämplarna gäller per talartur eller talstycke.
- Språkidentifiering görs per stycke. Ett enstaka engelskt ord i en svensk mening behandlas som svenska, vilket brukar bli rätt.
- Talarseparering kan slå ihop två personer med liknande röst. Döp om och slå ihop i fönstret innan du sparar.
- Appen är inte signerad med Apple-certifikat.

## Integritet

- Under inspelning skrivs ljudet som WAV till inspelningsmappen (standard: `iCloud Drive/01_CLAUDE_CODE/speak/inspelningar`, valbar i Inställningar; ligger den i iCloud Drive synkas ljudet dit) så att inget går förlorat om något kraschar. Filen tas bort när anteckningen är sparad eller mötet kastas, och rester äldre än ett dygn städas vid start. Vill du behålla ljudet: bocka i det i Inställningar.
- Inga loggar innehåller transkriberad text.
- Ingen telemetri, ingen uppdateringskontroll, inga externa anrop.
