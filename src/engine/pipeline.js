'use strict';
// Transkriberingsmotorn. Allt körs lokalt: whisper.cpp (Metal), sherpa-onnx (whisper på CPU) eller
// Klang Pianissimo med NeMo i Python, plus Silero VAD och pyannote-talarseparering.

const path = require('path');
const os = require('os');
const models = require('./models');
const { assignSpeakers, relabelSpeakers, coalesce, channelActivity, combineChannelDiarization, segmentsFromWords, mergeSimilarSpeakers } = require('./merge');
const { isHallucination, tidy } = require('./cleanup');
const audio = require('./audio');
const whispercpp = require('./whispercpp');
const pianissimo = require('./pianissimo');

const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;
const MAX_CHUNK_SEC = 28; // whisper klarar 30 s per anrop
// Talarseparering: högre tröskel = färre "nya" röster. 0.5 gav 50 talare i ett möte med 25.
const DIARIZE_THRESHOLD = 0.85;
// Stycken kortare än så här litar vi inte på för språkdetektering; de får huvudspråket.
const MIN_AUTO_LANG_SEC = 3;
// Livetext: kortare talstycken så att texten dyker upp snabbt medan mötet pågår.
const LIVE_MAX_SPEECH_SEC = 12;


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

// Delar långt ljud i stycken om cirka `chunkSec` sekunder. Varje gräns läggs i den tystaste halvsekunden
// under de sista 30 sekunderna före gränsen, så att inget ord klipps mitt av. Kortare ljud än `minSec` delas inte.
function splitLong(samples, { chunkSec = 600, minSec = 900, searchSec = 30 } = {}) {
  const total = samples.length;
  if (total <= minSec * SAMPLE_RATE) return [{ start: 0, samples }];
  const win = Math.round(0.5 * SAMPLE_RATE);
  const parts = [];
  let from = 0;
  while (total - from > (chunkSec + 120) * SAMPLE_RATE) {
    const target = from + chunkSec * SAMPLE_RATE;
    let best = target, bestE = Infinity;
    for (let s = target - searchSec * SAMPLE_RATE; s + win <= target; s += Math.round(win / 2)) {
      let e = 0;
      for (let k = s; k < s + win; k += 4) e += samples[k] * samples[k];
      if (e < bestE) { bestE = e; best = s + Math.round(win / 2); }
    }
    parts.push({ start: from / SAMPLE_RATE, samples: samples.subarray(from, best) });
    from = best;
  }
  parts.push({ start: from / SAMPLE_RATE, samples: samples.subarray(from) });
  return parts;
}
const fmtTime = (sec) => { const m = Math.floor(sec / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; };

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
    this.live = null;
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


  // Pianissimo (NeMo i Python)? Returnerar arbetaren, annars null.
  pyWorker() {
    const files = models.whisperFiles(this.modelsDir, this.whisperName);
    return files && files.py ? pianissimo.worker(files.dir) : null;
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
    if (files.py) throw new Error('Den här modellen körs med NeMo i Python, inte sherpa.');
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

  async meetingCpp(input, { policy, diarize = true, diarizer, channels, speakerCount = 0, prompt, onProgress } = {}) {
    const wavPath = typeof input === 'string' ? input : null;
    const samples = wavPath ? audio.readWav(wavPath).samples : input;
    const durationSec = samples.length / SAMPLE_RATE;
    const { language = 'auto', primary = 'sv' } = policy || {};
    console.error(`[motor] möte (whisper.cpp): ${durationSec.toFixed(1)} s, språk=${language}, antal talare=${speakerCount || 'auto'}`);
    // Modellen bestäms nu: dikterar du medan talarna letas fram byter dikteringen modell, och mötet ska
    // ändå köras med mötets modell.
    const model = this.ggmlModel();
    const t0 = Date.now();
    const { diar, via } = await this.speakerTimeline({ wavPath, samples, diarize, diarizer, channels, speakerCount, onProgress });
    const t1 = Date.now();
    const opts = { binary: this.whisperCli, model, language: language === 'auto' ? 'auto' : language, threads: this.numThreads, prompt };
    // Långa möten delas i stycken om cirka tio minuter, klippta i en tyst stund. Då kan ett stycke som
    // fastnar inte stoppa hela mötet: det avbryts, körs om enklare, och resten fortsätter.
    const parts = splitLong(samples);
    const raw = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const report = onProgress ? (f) => onProgress({ phase: 'transcribe', unit: 'percent', done: ((i + f) / parts.length) * 100, total: 100 }) : null;
      let segs = null;
      for (const greedy of [false, true]) {
        try {
          segs = parts.length === 1 && wavPath && !greedy
            ? await whispercpp.transcribeWav(wavPath, { ...opts, onProgress: report })
            : await whispercpp.transcribeSamples(part.samples, { ...opts, greedy, onProgress: report });
          break;
        } catch (e) {
          console.error(`[motor] stycke ${i + 1}/${parts.length} (${fmtTime(part.start)}) misslyckades${greedy ? ' igen' : ''}: ${e.message}`);
        }
      }
      if (!segs) segs = [{ start: 0, end: part.samples.length / SAMPLE_RATE, text: `[Det här stycket kunde inte transkriberas, ${fmtTime(part.start)}–${fmtTime(part.start + part.samples.length / SAMPLE_RATE)}]` }];
      for (const s of segs) raw.push({ ...s, start: s.start + part.start, end: s.end + part.start });
      if (report) report(1);
    }
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
    return { segments: merged, speakers: labeled.speakers, languages, durationSec, engine: 'whisper.cpp', timing, diarizer: via };
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
  async meeting(input, { policy, diarize = true, diarizer, channels, speakerCount = 0, onProgress } = {}) {
    // Egen WAV-läsare: sherpas readWave ger externa buffertar som Electrons utility-process inte tillåter.
    const wavPath = typeof input === 'string' ? input : null;
    const samples = wavPath ? audio.readWav(wavPath).samples : input;
    const durationSec = samples.length / SAMPLE_RATE;
    console.error(`[motor] möte: ${durationSec.toFixed(1)} s ljud, talarseparering=${diarize}, antal talare=${speakerCount || 'auto'}`);
    const name = this.whisperName; // dikterar du under tiden får mötet ändå sin egen modell
    const t0 = Date.now();

    const { diar, via } = await this.speakerTimeline({ wavPath, samples, diarize, diarizer, channels, speakerCount, onProgress });

    const t1 = Date.now();
    this.setWhisper(name);
    this.ensureRecognizer();
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

    const t2 = Date.now();
    const timing = { diarizeSec: (t1 - t0) / 1000, transcribeSec: (t2 - t1) / 1000, totalSec: (t2 - t0) / 1000, speed: durationSec / Math.max(0.001, (t2 - t0) / 1000) };
    console.error(`[motor] klart (sherpa): talare ${timing.diarizeSec.toFixed(1)} s, taligenkänning ${timing.transcribeSec.toFixed(1)} s, totalt ${timing.totalSec.toFixed(1)} s (${timing.speed.toFixed(1)}× realtid)`);
    if (diar.length) segs = assignSpeakers(segs, diar);
    const labeled = relabelSpeakers(segs);
    const merged = coalesce(labeled.segments, { maxGap: 1.5, maxLen: 60 });
    const languages = [...new Set(merged.map((s) => s.lang).filter(Boolean))];
    return { segments: merged, speakers: labeled.speakers, languages, durationSec, engine: 'sherpa', timing, diarizer: via };
  }

  // ---- Talare ----
  // Vem pratar när? Med två kanaler (mikrofon + datorns ljud) är allt från mikrofonen "Jag", och bara
  // datorns ljud separeras. Separeringen görs med NVIDIA Nemotron 3 Diarization när den är installerad
  // (max 8 talare), annars med den inbyggda (pyannote-segmentering + röstavtryck via sherpa).
  async speakerTimeline({ wavPath, samples, diarize = true, diarizer = 'nemotron', channels, speakerCount = 0, onProgress } = {}) {
    if (!diarize) return { diar: [], via: 'av' };
    if (onProgress) onProgress({ phase: 'diarize', done: 0, total: 1 });
    let runs = null;
    let target = { wavPath, samples };
    let count = speakerCount;
    if (channels) {
      const mic = audio.readWav(channels.mic).samples;
      const sys = audio.readWav(channels.sys).samples;
      runs = channelActivity(mic, sys, SAMPLE_RATE);
      target = { wavPath: channels.sys, samples: sys };
      count = speakerCount > 1 ? speakerCount - 1 : 0; // du själv räknas inte i datorns ljud
    }
    let result;
    if (runs && !runs.some((r) => r.source === 'sys')) {
      result = { diar: runs.map((r) => ({ start: r.start, end: r.end, speaker: 'me' })), via: 'kanaler' };
    } else {
      const d = await this.diarizeAudio(target, count, diarizer);
      result = runs ? { diar: combineChannelDiarization(runs, d.diar), via: `${d.via} + kanaler` } : d;
    }
    // Samma person kan få ett nytt nummer mitt i ett långt möte. Jämför rösterna och slå ihop.
    try {
      result.diar = this.fixSpeakerDrift(result.diar, target.samples || audio.readWav(target.wavPath).samples, count);
    } catch (e) {
      console.error('[motor] röstjämförelsen hoppades över:', e.message);
    }
    if (onProgress) onProgress({ phase: 'diarize', done: 1, total: 1 });
    console.error(`[motor] talare: ${result.via}, ${result.diar.length} stycken`);
    return result;
  }

  // Röstavtryck per talare (3D-Speaker via sherpa), från talarens längsta stycken, högst 60 sekunder.
  // Talare som låter som samma person slås ihop. count: antal talare om användaren angett det.
  fixSpeakerDrift(diar, samples, count = 0) {
    const ids = [...new Set(diar.map((d) => d.speaker).filter((s) => s !== 'me'))];
    if (ids.length < 2 || !samples) return diar;
    const modelPath = models.auxPath(this.modelsDir, 'embedding');
    if (!require('fs').existsSync(modelPath)) return diar;
    if (!this.embedder) this.embedder = new this.s.SpeakerEmbeddingExtractor({ model: modelPath, numThreads: this.numThreads, debug: 0, provider: 'cpu' });
    const voices = {};
    for (const id of ids) {
      const turns = diar.filter((d) => d.speaker === id && d.end - d.start >= 1.5).sort((a, b) => (b.end - b.start) - (a.end - a.start));
      let used = 0;
      let sum = null;
      for (const t of turns) {
        if (used >= 60) break;
        const clip = samples.subarray(Math.floor(t.start * SAMPLE_RATE), Math.floor(Math.min(t.end, t.start + 20) * SAMPLE_RATE));
        if (clip.length < SAMPLE_RATE * 1.5) continue;
        const st = this.embedder.createStream();
        st.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: clip });
        st.inputFinished();
        if (!this.embedder.isReady(st)) continue;
        const e = this.embedder.compute(st);
        sum = sum ? sum.map((x, i) => x + e[i]) : Float32Array.from(e);
        used += clip.length / SAMPLE_RATE;
      }
      if (sum && used >= 2) voices[id] = { emb: sum, sec: used };
    }
    const maxSpeakers = count > 0 ? count : 0;
    const map = mergeSimilarSpeakers(voices, { maxSpeakers });
    const merged = Object.entries(map).filter(([a, b]) => a !== b);
    if (!merged.length) return diar;
    console.error(`[motor] röstjämförelse: slog ihop ${merged.map(([a, b]) => `${a}→${b}`).join(', ')}`);
    return diar.map((d) => (map[d.speaker] !== undefined ? { ...d, speaker: typeof d.speaker === 'number' ? Number(map[d.speaker]) : map[d.speaker] } : d));
  }

  async diarizeAudio({ wavPath, samples }, count, diarizer) {
    const useNemotron = diarizer !== 'standard' && models.nemotronInstalled(this.modelsDir) && !(count > 8);
    if (useNemotron) {
      let tmp = null;
      try {
        let p = wavPath;
        if (!p) { tmp = path.join(os.tmpdir(), `speak-diar-${process.pid}-${Date.now()}.wav`); audio.writeWav(tmp, samples); p = tmp; }
        const t0 = Date.now();
        const diar = await pianissimo.worker(models.nemotronDir(this.modelsDir)).diarize(p);
        console.error(`[motor] Nemotron 3: ${new Set(diar.map((d) => d.speaker)).size} talare på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        return { diar, via: 'Nemotron 3' };
      } catch (e) {
        console.error('[motor] Nemotron misslyckades, använder den inbyggda:', e.message);
      } finally {
        if (tmp) require('fs').rmSync(tmp, { force: true });
      }
    }
    const s = samples || audio.readWav(wavPath).samples;
    return { diar: this.ensureDiarizer(count > 0 ? count : -1).process(s), via: 'standard' };
  }

  // ---- Pianissimo (NeMo i Python), som modellkortet beskriver ----
  // Hela filen skickas i ett anrop med tidsstämplar; modellens lokala attention klarar långa inspelningar.
  async meetingPy(wavPath, { diarize = true, diarizer, channels, speakerCount = 0, onProgress } = {}) {
    const w = this.pyWorker();
    const samples = audio.readWav(wavPath).samples;
    const durationSec = samples.length / SAMPLE_RATE;
    console.error(`[motor] möte (Pianissimo): ${durationSec.toFixed(1)} s, antal talare=${speakerCount || 'auto'}`);
    const t0 = Date.now();
    const { diar, via } = await this.speakerTimeline({ wavPath, samples, diarize, diarizer, channels, speakerCount, onProgress });
    const t1 = Date.now();
    // På Macen körs Pianissimo på processorn (inte grafikkretsen), så ett långt möte i ett enda anrop
    // blir tungt och säger inget om hur långt det kommit. Långa möten körs därför i stycken om cirka
    // tio minuter, klippta i en tyst stund, med förlopp i procent.
    const parts = splitLong(samples);
    const r = { segments: [], words: [], text: '' };
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (onProgress) onProgress({ phase: 'transcribe', unit: 'percent', done: (i / parts.length) * 100, total: 100 });
      const one = parts.length === 1 ? await w.transcribe(wavPath, { timestamps: true }) : await w.transcribeSamples(part.samples, { timestamps: true });
      const shift = (x) => ({ ...x, start: x.start != null ? x.start + part.start : x.start, end: x.end != null ? x.end + part.start : x.end });
      r.segments.push(...(one.segments || []).map(shift));
      r.words.push(...(one.words || []).map(shift));
      r.text += (r.text ? ' ' : '') + (one.text || '');
      console.error(`[motor] Pianissimo stycke ${i + 1}/${parts.length} klart`);
    }
    if (onProgress) onProgress({ phase: 'transcribe', unit: 'percent', done: 100, total: 100 });
    const t2 = Date.now();
    let segs = (r.segments || []).filter((x) => x.start != null && x.end != null)
      .map((x) => ({ start: x.start, end: x.end, text: tidy(x.text), lang: 'sv', speaker: 0 }))
      .filter((x) => x.text && !isHallucination(x.text));
    if (!segs.length && r.text) segs = [{ start: 0, end: durationSec, text: tidy(r.text), lang: 'sv', speaker: 0 }];
    // Med talare: koppla varje ord till en talare, så att byten mitt i en mening hamnar rätt.
    const words = (r.words || []).filter((x) => x.start != null && x.end != null && x.word);
    const byWords = diar.length && words.length;
    const timing = { diarizeSec: (t1 - t0) / 1000, transcribeSec: (t2 - t1) / 1000, totalSec: (t2 - t0) / 1000, speed: durationSec / Math.max(0.001, (t2 - t0) / 1000) };
    console.error(`[motor] klart (Pianissimo): talare ${timing.diarizeSec.toFixed(1)} s, Pianissimo ${timing.transcribeSec.toFixed(1)} s, totalt ${timing.totalSec.toFixed(1)} s (${timing.speed.toFixed(1)}× realtid)`);
    if (byWords) segs = segmentsFromWords(words, diar, { lang: 'sv' }).map((x) => ({ ...x, text: tidy(x.text) })).filter((x) => x.text && !isHallucination(x.text));
    else if (diar.length) segs = assignSpeakers(segs, diar);
    const labeled = relabelSpeakers(segs);
    const merged = coalesce(labeled.segments, { maxGap: 1.5, maxLen: 60 });
    return { segments: merged, speakers: labeled.speakers, languages: ['sv'], durationSec, engine: 'pianissimo', timing, diarizer: via };
  }

  // Mötet är redan transkriberat under inspelningen (livetexten). Här läggs bara talare och tider på
  // de färdiga styckena, så att inget behöver köras om. Mycket snabbare än en ny körning.
  async meetingFromLive(wavPath, { segments, diarize = true, diarizer, channels, speakerCount = 0, onProgress } = {}) {
    const samples = audio.readWav(wavPath).samples;
    const durationSec = samples.length / SAMPLE_RATE;
    console.error(`[motor] möte från livetexten: ${durationSec.toFixed(1)} s, ${segments.length} stycken`);
    const t0 = Date.now();
    const { diar, via } = await this.speakerTimeline({ wavPath, samples, diarize, diarizer, channels, speakerCount, onProgress });
    let segs = (segments || []).map((s) => ({ start: s.start, end: s.end, text: tidy(s.text), lang: 'sv', speaker: 0 }))
      .filter((s) => s.text && !isHallucination(s.text));
    if (diar.length) segs = assignSpeakers(segs, diar);
    const labeled = relabelSpeakers(segs);
    const merged = coalesce(labeled.segments, { maxGap: 1.5, maxLen: 60 });
    const totalSec = (Date.now() - t0) / 1000;
    const timing = { diarizeSec: totalSec, transcribeSec: 0, totalSec, speed: durationSec / Math.max(0.001, totalSec) };
    return { segments: merged, speakers: labeled.speakers, languages: ['sv'], durationSec, engine: 'livetext', timing, diarizer: via };
  }

  async dictatePy(samples) {
    const t0 = Date.now();
    const r = await this.pyWorker().transcribeSamples(samples);
    console.error(`[motor] diktering (Pianissimo): ${(samples.length / SAMPLE_RATE).toFixed(1)} s ljud på ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const text = tidy(r.text || '');
    const segs = text && !isHallucination(text) ? [{ start: 0, end: samples.length / SAMPLE_RATE, text, lang: 'sv' }] : [];
    return { text: segs.map((x) => x.text).join(' '), languages: ['sv'], segments: segs };
  }

  // ---- Livetext under inspelning ----
  // Ljud matas in i bitar medan mötet pågår. En egen röstdetektor hittar avslutade talstycken,
  // som transkriberas direkt. Resultatet är grovt; den noggranna körningen görs när mötet stoppas.
  async liveStart() {
    const model = models.auxPath(this.modelsDir, 'vad');
    if (!require('fs').existsSync(model)) throw new Error('Röstdetektorn saknas. Ladda ner talarmodellerna i Inställningar.');
    // Ladda modellen nu, inte vid första talstycket.
    const w = this.pyWorker();
    if (w) await w.load('asr');
    else if (!this.ggmlModel()) this.ensureRecognizer();
    const vad = new this.s.Vad({
      sileroVad: { model, threshold: 0.5, minSilenceDuration: 0.4, minSpeechDuration: 0.25, windowSize: VAD_WINDOW, maxSpeechDuration: LIVE_MAX_SPEECH_SEC },
      sampleRate: SAMPLE_RATE, numThreads: 1, provider: 'cpu', debug: 0,
    }, 60);
    this.live = { vad, rest: new Float32Array(0) };
    return true;
  }

  async liveFeed(samples) {
    if (!this.live) return [];
    const { vad } = this.live;
    const all = new Float32Array(this.live.rest.length + samples.length);
    all.set(this.live.rest, 0);
    all.set(samples, this.live.rest.length);
    let i = 0;
    for (; i + VAD_WINDOW <= all.length; i += VAD_WINDOW) vad.acceptWaveform(all.subarray(i, i + VAD_WINDOW));
    this.live.rest = all.slice(i);
    return this.liveDrain();
  }

  async liveStop() {
    if (!this.live) return [];
    this.live.vad.flush();
    const out = await this.liveDrain();
    this.live = null;
    return out;
  }

  async liveDrain() {
    const { vad } = this.live;
    const pieces = [];
    while (!vad.isEmpty()) {
      const f = vad.front(false);
      pieces.push({ start: f.start / SAMPLE_RATE, samples: f.samples });
      vad.pop();
    }
    const out = [];
    for (const p of pieces) {
      const dur = p.samples.length / SAMPLE_RATE;
      if (dur < 0.5) continue;
      let text;
      const w = this.pyWorker();
      if (w) {
        text = (await w.transcribeSamples(p.samples)).text || '';
      } else if (this.ggmlModel()) {
        const segs = await whispercpp.transcribeSamples(p.samples, { binary: this.whisperCli, model: this.ggmlModel(), language: 'sv', threads: this.numThreads });
        text = segs.map((s) => s.text).join(' ');
      } else {
        text = this.decodeWithPolicy(p.samples, { language: 'sv' }).text;
      }
      text = tidy(text);
      if (text && !isHallucination(text)) out.push({ start: p.start, end: p.start + dur, text });
    }
    return out;
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

module.exports = { Pipeline, SAMPLE_RATE, splitLong, audio, modelsDir: (base) => path.join(base, 'models') };
