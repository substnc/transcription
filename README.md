# Diktera

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

**Mötesläge**
- Spela in via mikrofonen eller ladda upp en ljud- eller videofil (mp3, m4a, wav, mp4 med flera).
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
| Taligenkänning | Whisper via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | På datorn (CPU) |
| Röstdetektor | Silero VAD | På datorn |
| Talarseparering | pyannote segmentation 3.0 + 3D-Speaker | På datorn |
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
npm run models          # laddar ner whisper-small + röst- och talarmodeller (ca 650 MB)
npm start
```

Första gången ber macOS om tre behörigheter. Alla behövs:

1. **Mikrofon**: för att höra dig.
2. **Tillgänglighet**: för att kunna klistra in med ⌘V.
3. **Inmatningsövervakning**: för att märka när du håller in tangenten.

Om håll-in-tangenten inte reagerar: öppna Systeminställningar → Integritet och säkerhet,
lägg till Diktera under både Tillgänglighet och Inmatningsövervakning, och starta om appen.

### Modeller

Väljs i Inställningar. Svenska behöver minst `small`. Rekommendation för Apple Silicon: `turbo`.

| Modell | Storlek | Kommentar |
|---|---|---|
| small | 600 MB | Rimlig svenska, snabb |
| turbo | 560 MB | Large-v3 turbo. Bäst balans |
| medium | 1.5 GB | Bra, långsammare |
| large-v3 | 1.9 GB | Bäst kvalitet, långsammast |

`npm run models -- turbo` laddar ner en annan modell från terminalen.

### Ollama (valfritt men rekommenderat)

Installera [Ollama](https://ollama.com) och hämta en modell, till exempel:

```bash
ollama pull qwen2.5:7b
```

Diktera hittar den automatiskt och använder den för att städa dikterad text och
sammanfatta möten. Utan Ollama används enkla regler, och sammanfattningen märks
som automatisk grovsammanfattning.

## Färdig app (dmg)

Varje push bygger appen på GitHubs Mac-maskiner och lägger en dmg under
**Releases** i repot. Ladda ner den som passar din Mac (arm64 = Apple Silicon,
x64 = Intel), dra Diktera till Program och kör sedan en gång i Terminal:

```bash
xattr -cr /Applications/Diktera.app
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
src/engine/     ren Node: modeller, ljud, whisper-pipeline, städning, sammanfattning, markdown
src/main/       Electron: menyrad, tangentlyssning, inklistring, fönster, IPC
src/renderer/   fönster: osynlig mikrofon, statuspill, mötesläge, inställningar
scripts/        nedladdning av modeller, ikoner
test/           node:test
```

Motorn körs i en egen process så att appen aldrig hänger under transkribering.

## Kända begränsningar

- Mötesinspelning tar bara upp mikrofonen. Ljud från ett videomöte fångas via högtalarna, inte via systemljudet.
- Whisper ger inga ordvisa tidsstämplar. Tidsstämplarna gäller per talartur eller talstycke.
- Språkidentifiering görs per stycke. Ett enstaka engelskt ord i en svensk mening behandlas som svenska, vilket brukar bli rätt.
- Talarseparering kan slå ihop två personer med liknande röst. Döp om och slå ihop i fönstret innan du sparar.
- Appen är inte signerad med Apple-certifikat.

## Integritet

- Ljud sparas som WAV i `~/Library/Application Support/Diktera/recordings` så att inget går förlorat om något kraschar. Kan stängas av i Inställningar.
- Inga loggar innehåller transkriberad text.
- Ingen telemetri, ingen uppdateringskontroll, inga externa anrop.
