'use strict';
// Transkriberingsmotorn. Allt körs lokalt med sherpa-onnx (whisper + Silero VAD + pyannote-talarseparering).

const path = require('path');
const models = require('./models');
const { turnsFromDiarization, relabelSpeakers, coalesce } = require('./merge');
const { isHallucination, tidy } = require('./cleanup');
const audio = require('./audio');

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;
const MAX_CHUNK_SEC = 28; // whisper klarar 30 s per anrop

// Ett trasigt modellfil får onnxruntime att avsluta hela processen. Kontrollera innan.
function checkModelFile(file, label) {
  const fs = require('fs');
  if (!fs.existsSync(file)) throw new Error(`${label}: filen saknas (${file}). Ladda ner modellen igen i Inställningar.`);
  const st = fs.statSync(file);
  if (st.size < 100000) throw new Error(`${label}: filen är trasig eller ofullständig (${st.size} byte). Ta bort och ladda ner igen.`);
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

  ensureRecognizer() {
    if (this.recognizer) return this.recognizer;
    const files = models.whisperFiles(this.modelsDir, this.whisperName);
    if (!files) throw new Error(`Whisper-modellen "${this.whisperName}" är inte nedladdad. Öppna Inställningar och ladda ner den.`);
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

  ensureDiarizer() {
    if (this.diarizer) return this.diarizer;
    const st = models.status(this.modelsDir);
    if (!st.aux.segmentation.installed || !st.aux.embedding.installed) throw new Error('Talarmodellerna är inte nedladdade. Öppna Inställningar.');
    checkModelFile(models.auxPath(this.modelsDir, 'segmentation'), 'Talarsegmentering');
    checkModelFile(models.auxPath(this.modelsDir, 'embedding'), 'Talarigenkänning');
    console.error('[motor] laddar talarmodeller');
    this.diarizer = new this.s.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: models.auxPath(this.modelsDir, 'segmentation') }, numThreads: this.numThreads, debug: 0, provider: 'cpu' },
      embedding: { model: models.auxPath(this.modelsDir, 'embedding'), numThreads: this.numThreads, debug: 0, provider: 'cpu' },
      clustering: { numClusters: -1, threshold: 0.5 },
      minDurationOn: 0.3,
      minDurationOff: 0.5,
    });
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

  // Mötesläge: talarseparering först, sedan whisper per talartur.
  meeting(input, { policy, diarize = true, onProgress } = {}) {
    // Egen WAV-läsare: sherpas readWave ger externa buffertar som Electrons utility-process inte tillåter.
    const samples = typeof input === 'string' ? audio.readWav(input).samples : input;
    const durationSec = samples.length / SAMPLE_RATE;
    console.error(`[motor] möte: ${durationSec.toFixed(1)} s ljud, talarseparering=${diarize}`);
    let turns;
    if (diarize) {
      if (onProgress) onProgress({ phase: 'diarize', done: 0, total: 1 });
      const d = this.ensureDiarizer().process(samples);
      turns = turnsFromDiarization(d);
      if (onProgress) onProgress({ phase: 'diarize', done: 1, total: 1 });
    }
    if (!turns || !turns.length) turns = [{ start: 0, end: durationSec, speaker: 0 }];

    let segs = [];
    turns.forEach((t, i) => {
      const a = Math.max(0, Math.floor(t.start * SAMPLE_RATE));
      const b = Math.min(samples.length, Math.ceil(t.end * SAMPLE_RATE));
      if (b - a < SAMPLE_RATE * 0.3) return;
      segs.push(...this.transcribeChunk(samples.subarray(a, b), {
        policy, offset: a / SAMPLE_RATE, speaker: t.speaker, done: i, total: turns.length, onProgress,
      }));
    });
    segs.sort((x, y) => x.start - y.start);
    const labeled = relabelSpeakers(segs);
    const merged = coalesce(labeled.segments);
    const languages = [...new Set(merged.map((s) => s.lang).filter(Boolean))];
    return { segments: merged, speakers: labeled.speakers, languages, durationSec };
  }
}

module.exports = { Pipeline, SAMPLE_RATE, audio, modelsDir: (base) => path.join(base, 'models') };
