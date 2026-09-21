'use strict';
// Transkriberingsmotorn. Allt körs lokalt med sherpa-onnx (whisper + Silero VAD + pyannote-talarseparering).

const path = require('path');
const models = require('./models');
const { assignSpeakers, relabelSpeakers, coalesce } = require('./merge');
const { isHallucination, tidy } = require('./cleanup');
const audio = require('./audio');
const whispercpp = require('./whispercpp');

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;
const MAX_CHUNK_SEC = 28; // whisper klarar 30 s per anrop
// Talarseparering: högre tröskel = färre "nya" röster. 0.5 gav 50 talare i ett möte med 25.
const DIARIZE_THRESHOLD = 0.85;
// Stycken kortare än så här litar vi inte på för språkdetektering; de får huvudspråket.
const MIN_AUTO_LANG_SEC = 3;

// Ett trasigt modellfil får onnxruntime att avsluta hela processen. Kontrollera innan.
function checkModelFile(file, label) {
  const fs = require('fs');
  if (!fs.existsSync(file)) throw new Error(`${label}: filen saknas (${file}). Ladda ner modellen igen i Inställningar.`);
  const st = fs.statSync(file);
  // Stora modeller kan ha vikterna i en separat .data-fil bredvid (ONNX external data).
  const hasExternal = fs.existsSync(file + '.data') || fs.existsSync(file.replace(/\.onnx$/, '.weights'));
  if (st.size < 100000 && !hasExternal) throw new Error(`${label}: filen är trasig eller ofullständig (${st.size} byte). Ta bort och ladda ner igen.`);
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(8);
  fs.readSync(fd, head, 0, 8, 0);
  fs.closeSync(fd);
  const text = head.toString('latin1');
  if (/^(<|Not Found|\{)/.test(text)) throw new Error(`${label}: filen innehåller inte en modell. Ta bort och ladda ner igen.`);
}

function loadSherpa() {
  // Kräver den plattformsspecifika binären (sherpa-onnx-darwin-arm64 på Apple Silicon).
  return require('sherpa-onnx-node');
}

class Pipeline {
  constructor(opts = {}) {
    this.modelsDir = opts.modelsDir;
    this.whisperName = opts.whisper || 'small';
    this.numThreads = opts.numThreads || Math.max(2, Math.min(8, require('os').cpus().length - 2));
    this.sherpa = opts.sherpa || null;
    this.whisperCli = opts.whisperCli || null;
    this.recognizer = null;
    this.vad = null;
    this.diarizer = null;
    this.currentLanguage = null;
    this.loadedWhisper = null;
  }

  get s() {
    if (!this.sherpa) this.sherpa = loadSherpa();
    return this.sherpa;
  }

  status() {
    return { ...models.status(this.modelsDir), active: this.whisperName, loaded: this.loadedWhisper };
  }

  setWhisper(name) {
    if (name !== this.whisperName) {
      this.whisperName = name;
      this.recognizer = null;
      this.loadedWhisper = null;
    }
  }

  // ggml-modell (whisper.cpp på Metal) eller ONNX (sherpa på CPU)?
  ggmlModel() {
    const files = models.whisperFiles(this.modelsDir, this.whisperName);
    return files && files.ggml ? files.ggml : null;
  }

  ensureRecognizer() {
    if (this.recognizer) return this.recognizer;
    const files = models.whisperFiles(this.modelsDir, this.whisperName);
    if (!files) throw new Error(`Whisper-modellen "${this.whisperName}" är inte nedladdad. Öppna Inställningar och ladda ner den.`);
    if (files.ggml) throw new Error('Den här modellen körs med whisper.cpp, inte sherpa.');
    checkModelFile(files.encoder, 'Whisper encoder');
    checkModelFile(files.decoder, 'Whisper decoder');
    console.error(`[motor] laddar whisper-${this.whisperName} (${this.numThreads} trådar)`);
    this.config = {
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        whisper: { encoder: files.encoder, decoder: files.decoder, language: '', task: 'transcribe', tailPaddings: -1 },
        tokens: files.tokens,
        numThreads: this.numThreads,
        provider: 'cpu',
        debug: 0,
      },
    };
    this.recognizer = new this.s.OfflineRecognizer(this.config);
    this.currentLanguage = '';
    this.loadedWhisper = this.whisperName;
    return this.recognizer;
  }

  ensureVad() {
    if (this.vad) return this.vad;
    const model = models.auxPath(this.modelsDir, 'vad');
    if (!require('fs').existsSync(model)) throw new Error('Röstdetektorn (Silero VAD) är inte nedladdad. Öppna Inställningar.');
    checkModelFile(model, 'Röstdetektor');
    this.vad = new this.s.Vad({
      sileroVad: { model, threshold: 0.5, minSilenceDuration: 0.5, minSpeechDuration: 0.25, windowSize: VAD_WINDOW, maxSpeechDuration: MAX_CHUNK_SEC },
      sampleRate: SAMPLE_RATE, numThreads: 1, provider: 'cpu', debug: 0,
    }, 120);
    return this.vad;
  }

  ensureDiarizer(numClusters = -1) {
    if (this.diarizer) {
      if (numClusters !== this.diarizerClusters) {
        this.diarizer.setConfig({ clustering: { numClusters, threshold: DIARIZE_THRESHOLD } });
        this.diarizerClusters = numClusters;
      }
      return this.diarizer;
    }
    const st = models.status(this.modelsDir);
    if (!st.aux.segmentation.installed || !st.aux.embedding.installed) throw new Error('Talarmodellerna är inte nedladdade. Öppna Inställningar.');
    checkModelFile(models.auxPath(this.modelsDir, 'segmentation'), 'Talarsegmentering');
    checkModelFile(models.auxPath(this.modelsDir, 'embedding'), 'Talarigenkänning');
    console.error('[motor] laddar talarmodeller');
    this.diarizer = new this.s.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: models.auxPath(this.modelsDir, 'segmentation') }, numThreads: this.numThreads, debug: 0, provider: 'cpu' },
      embedding: { model: models.auxPath(this.modelsDir, 'embedding'), numThreads: this.numThreads, debug: 0, provider: 'cpu' },
      clustering: { numClusters, threshold: DIARIZE_THRESHOLD },
      minDurationOn: 0.5,
      minDurationOff: 0.8,
    });
    this.diarizerClusters = numClusters;
    return this.diarizer;
  }

  setLanguage(lang) {
    const rec = this.ensureRecognizer();
    const l = lang === 'auto' ? '' : lang || '';
    if (l === this.currentLanguage) return;
    const cfg = JSON.parse(JSON.stringify(this.config));
    cfg.modelConfig.whisper.language = l;
    rec.setConfig(cfg);
    this.currentLanguage = l;
  }

  // Kör whisper på ett ljudstycke (max ~30 s). Returnerar { text, lang }.
  decode(samples, lang) {
    const rec = this.ensureRecognizer();
    this.setLanguage(lang);
    const st = rec.createStream();
    st.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
    rec.decode(st);
    const r = rec.getResult(st);
    return { text: (r.text || '').trim(), lang: r.lang || lang || '' };
  }

  // Språkpolicy: auto-detektera, men tillåt bara de valda språken. Annat tvingas till huvudspråket.
  decodeWithPolicy(samples, policy) {
    const { language = 'auto', allowed = ['sv', 'en'], primary = 'sv' } = policy || {};
    if (language !== 'auto') return this.decode(samples, language);
    if (samples.length < MIN_AUTO_LANG_SEC * SAMPLE_RATE) return this.decode(samples, allowed.includes(primary) ? primary : allowed[0]);
    let r = this.decode(samples, 'auto');
    if (allowed.length && !allowed.includes(r.lang)) r = this.decode(samples, allowed.includes(primary) ? primary : allowed[0]);
    return r;
  }

  // Delar upp ljud i talstycken med VAD. Returnerar [{ start (s), samples }].
  splitSpeech(samples) {
    const vad = this.ensureVad();
    vad.reset();
    for (let i = 0; i + VAD_WINDOW <= samples.length; i += VAD_WINDOW) vad.acceptWaveform(samples.subarray(i, i + VAD_WINDOW));
    vad.flush();
    const out = [];
    while (!vad.isEmpty()) {
      const f = vad.front(false); // kopierad buffert, ingen extern minnesyta
      out.push({ start: f.start / SAMPLE_RATE, samples: f.samples });
      vad.pop();
    }
    // Om VAD inte hittade något men det finns ljud: kör ändå i fasta bitar.
    if (!out.length && samples.length > SAMPLE_RATE * 0.3) {
      const step = MAX_CHUNK_SEC * SAMPLE_RATE;
      for (let i = 0; i < samples.length; i += step) out.push({ start: i / SAMPLE_RATE, samples: samples.subarray(i, i + step) });
    }
    return out;
  }

  // Transkriberar ett ljudstycke till segment med tidsstämplar. offset = var stycket börjar i hela filen.
  transcribeChunk(samples, { policy, offset = 0, speaker, onProgress, done = 0, total = 1 }) {
    const pieces = this.splitSpeech(samples);
    const segs = [];
    for (const p of pieces) {
      const r = this.decodeWithPolicy(p.samples, policy);
      const text = tidy(r.text);
      if (!isHallucination(text)) {
        segs.push({ start: offset + p.start, end: offset + p.start + p.samples.length / SAMPLE_RATE, text, lang: r.lang, speaker });
      }
      if (onProgress) onProgress({ phase: 'transcribe', done: done + (p.start + p.samples.length / SAMPLE_RATE) / (samples.length / SAMPLE_RATE), total });
    }
    return segs;
  }

  // ---- whisper.cpp-vägen (Metal) ----
  async dictateCpp(samples, { policy, prompt } = {}) {
    const { language = 'auto', primary = 'sv' } = policy || {};
    const t0 = Date.now();
    const segs = await whispercpp.transcribeSamples(samples, { binary: this.whisperCli, model: this.ggmlModel(), language: language === 'auto' ? 'auto' : language, threads: this.numThreads, prompt });
    console.error(`[motor] diktering (whisper.cpp): ${(samples.length / SAMPLE_RATE).toFixed(1)} s ljud på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const kept = segs.map((s) => ({ ...s, text: tidy(s.text), lang: language === 'auto' ? primary : language })).filter((s) => !isHallucination(s.text));
    return { text: kept.map((s) => s.text).join(' ').trim(), languages: [...new Set(kept.map((s) => s.lang))], segments: kept };
  }

  async meetingCpp(input, { policy, diarize = true, speakerCount = 0, prompt, onProgress } = {}) {
    const wavPath = typeof input === 'string' ? input : null;
    const samples = wavPath ? audio.readWav(wavPath).samples : input;
    const durationSec = samples.length / SAMPLE_RATE;
    const { language = 'auto', primary = 'sv' } = policy || {};
    console.error(`[motor] möte (whisper.cpp): ${durationSec.toFixed(1)} s, språk=${language}, antal talare=${speakerCount || 'auto'}`);
    const t0 = Date.now();
    let diar = [];
    if (diarize) {
      if (onProgress) onProgress({ phase: 'diarize', done: 0, total: 1 });
      diar = this.ensureDiarizer(speakerCount > 0 ? speakerCount : -1).process(samples);
      if (onProgress) onProgress({ phase: 'diarize', done: 1, total: 1 });
    }
    const t1 = Date.now();
    const opts = { binary: this.whisperCli, model: this.ggmlModel(), language: language === 'auto' ? 'auto' : language, threads: this.numThreads, prompt,
      onProgress: onProgress ? (f) => onProgress({ phase: 'transcribe', done: f * 100, total: 100 }) : null };
    const raw = wavPath ? await whispercpp.transcribeWav(wavPath, opts) : await whispercpp.transcribeSamples(samples, opts);
    const t2 = Date.now();
    // Tidtagning för hastighetsmätning: syns i loggen och i mötesfönstret.
    const timing = { diarizeSec: (t1 - t0) / 1000, transcribeSec: (t2 - t1) / 1000, totalSec: (t2 - t0) / 1000, speed: durationSec / Math.max(0.001, (t2 - t0) / 1000) };
    console.error(`[motor] klart: talare ${timing.diarizeSec.toFixed(1)} s, whisper.cpp ${timing.transcribeSec.toFixed(1)} s, totalt ${timing.totalSec.toFixed(1)} s (${timing.speed.toFixed(1)}× realtid)`);
    let segs = raw.map((s) => ({ start: s.start, end: s.end, text: tidy(s.text), lang: language === 'auto' ? primary : language, speaker: 0 }))
      .filter((s) => s.text && !isHallucination(s.text) && !isJunk(s.text, s.lang, s.end - s.start, policy));
    if (diar.length) segs = assignSpeakers(segs, diar);
    const labeled = relabelSpeakers(segs);
    const merged = coalesce(labeled.segments, { maxGap: 1.5, maxLen: 60 });
    const languages = [...new Set(merged.map((s) => s.lang).filter(Boolean))];
    return { segments: merged, speakers: labeled.speakers, languages, durationSec, engine: 'whisper.cpp', timing };
  }

  // Diktering: kort ljud, ingen talarseparering.
  // Under 28 s skickas hela klippet i ett stycke: whisper blir tydligt bättre med hela sammanhanget.
  dictate(samples, { policy } = {}) {
    let segs;
    if (samples.length <= MAX_CHUNK_SEC * SAMPLE_RATE) {
      const r = this.decodeWithPolicy(samples, policy);
      const text = tidy(r.text);
      segs = isHallucination(text) ? [] : [{ start: 0, end: samples.length / SAMPLE_RATE, text, lang: r.lang }];
    } else {
      segs = this.transcribeChunk(samples, { policy });
    }
    const langs = [...new Set(segs.map((s) => s.lang).filter(Boolean))];
    return { text: segs.map((s) => s.text).join(' ').trim(), languages: langs, segments: segs };
  }

  // Mötesläge: dela ljudet i naturliga talstycken (VAD), transkribera dem hela,
  // och märk talare efteråt utifrån talarsepareringen. Hela stycken ger whisper
  // sammanhang; korta talarturer gav hallucinationer.
  meeting(input, { policy, diarize = true, speakerCount = 0, onProgress } = {}) {
    // Egen WAV-läsare: sherpas readWave ger externa buffertar som Electrons utility-process inte tillåter.
    const samples = typeof input === 'string' ? audio.readWav(input).samples : input;
    const durationSec = samples.length / SAMPLE_RATE;
    console.error(`[motor] möte: ${durationSec.toFixed(1)} s ljud, talarseparering=${diarize}, antal talare=${speakerCount || 'auto'}`);

    let diar = [];
    if (diarize) {
      if (onProgress) onProgress({ phase: 'diarize', done: 0, total: 1 });
      diar = this.ensureDiarizer(speakerCount > 0 ? speakerCount : -1).process(samples);
      if (onProgress) onProgress({ phase: 'diarize', done: 1, total: 1 });
    }

    const pieces = this.splitSpeech(samples);
    let segs = [];
    pieces.forEach((p, i) => {
      const dur = p.samples.length / SAMPLE_RATE;
      if (dur < 0.6) return; // för kort för att ge riktig text
      const r = this.decodeWithPolicy(p.samples, policy);
      const text = tidy(r.text);
      if (!isHallucination(text) && !isJunk(text, r.lang, dur, policy)) {
        segs.push({ start: p.start, end: p.start + dur, text, lang: r.lang, speaker: 0 });
      }
      if (onProgress) onProgress({ phase: 'transcribe', done: i + 1, total: pieces.length });
    });

    if (diar.length) segs = assignSpeakers(segs, diar);
    const labeled = relabelSpeakers(segs);
    const merged = coalesce(labeled.segments, { maxGap: 1.5, maxLen: 60 });
    const languages = [...new Set(merged.map((s) => s.lang).filter(Boolean))];
    return { segments: merged, speakers: labeled.speakers, languages, durationSec };
  }
}

// Kort stycke på "fel" språk med bara några ord är nästan alltid brus som whisper gissat på.
function isJunk(text, lang, dur, policy) {
  const primary = (policy && policy.primary) || 'sv';
  const words = text.split(/\s+/).filter(Boolean).length;
  if (lang !== primary && dur < 2 && words <= 3) return true;
  if (words <= 1 && dur < 1.2) return true;
  return false;
}

module.exports = { Pipeline, SAMPLE_RATE, audio, modelsDir: (base) => path.join(base, 'models') };
