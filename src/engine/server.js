'use strict';
// Körs som en egen process (Electron utilityProcess eller vanlig node-fork) så att tunga
// modellanrop aldrig blockerar menyradsappen. Enkel RPC: { id, method, params } -> { id, result | error }.

const { Pipeline } = require('./pipeline');
const models = require('./models');
const llm = require('./llm');
const { heuristicSummary } = require('./summarize');
const { transcriptAsText } = require('./markdown');
const { cleanup } = require('./cleanup');
const { vocabularyPrompt } = require('./whispercpp');

let pipeline = null;
let livePipeline = null; // egen instans för livetext, så att den inte krockar med den noggranna körningen
let settings = {};

const port = process.parentPort || null;
function send(msg) {
  if (port) port.postMessage(msg);
  else if (process.send) process.send(msg);
}

const methods = {
  async init(p) {
    settings = { ...settings, ...p };
    pipeline = new Pipeline({ modelsDir: settings.modelsDir, whisper: settings.whisper, numThreads: settings.numThreads, whisperCli: settings.whisperCli });
    livePipeline = null;
    return models.status(settings.modelsDir);
  },
  async configure(p) {
    settings = { ...settings, ...p };
    if (pipeline && p.whisper) pipeline.setWhisper(p.whisper);
    return true;
  },

  // ---- Livetext ----
  async liveStart({ model }) {
    if (!model) throw new Error('Ingen modell vald för livetext.');
    if (!models.whisperFiles(settings.modelsDir, model)) throw new Error(`Modellen ${model} är inte installerad.`);
    if (!livePipeline || livePipeline.whisperName !== model) {
      livePipeline = new Pipeline({ modelsDir: settings.modelsDir, whisper: model, numThreads: Math.max(2, Math.min(4, require('os').cpus().length - 2)), whisperCli: settings.whisperCli, sherpa: pipeline && pipeline.sherpa });
    }
    await livePipeline.liveStart();
    return true;
  },
  async liveFeed({ samples }) {
    if (!livePipeline) return [];
    return livePipeline.liveFeed(samples instanceof Float32Array ? samples : new Float32Array(samples));
  },
  async liveStop() {
    return livePipeline ? livePipeline.liveStop() : [];
  },
  async status() {
    return { ...models.status(settings.modelsDir), loaded: pipeline ? pipeline.loadedWhisper : null };
  },
  async warmup() {
    if (!pipeline.ggmlModel()) pipeline.ensureRecognizer();
    pipeline.ensureVad();
    return true;
  },
  // Motorinfo per modell: körs den med whisper.cpp (ggml) eller sherpa (ONNX)? Utan namn: den laddade.
  async engineInfo({ name } = {}) {
    const files = name ? models.whisperFiles(settings.modelsDir, name) : null;
    return { ggml: name ? !!(files && files.ggml) : !!pipeline.ggmlModel(), py: !!(files && files.py), installed: name ? !!files : true, whisperCli: require('./whispercpp').findBinary(settings.whisperCli) };
  },
  async llmStatus() {
    return llm.available(settings.ollamaHost);
  },
  async installWhisper({ name }, id) {
    await models.installWhisper(settings.modelsDir, name, (prog) => send({ id, progress: { kind: 'download', name, ...prog } }));
    return models.status(settings.modelsDir);
  },
  async installAux({ key }, id) {
    await models.installAux(settings.modelsDir, key, (prog) => send({ id, progress: { kind: 'download', name: key, ...prog } }));
    return models.status(settings.modelsDir);
  },
  async importWhisper({ sourcePath }) {
    const name = await models.importWhisper(settings.modelsDir, sourcePath);
    return { name, status: models.status(settings.modelsDir) };
  },
  async removeWhisper({ name }) {
    if (pipeline && pipeline.loadedWhisper === name) { pipeline.recognizer = null; pipeline.loadedWhisper = null; }
    models.removeWhisper(settings.modelsDir, name);
    return models.status(settings.modelsDir);
  },

  // Diktering: samples (Float32Array 16 kHz) -> städad text.
  async dictate({ samples, policy, whisper, useLlm, voiceCommands, vocabulary }) {
    if (whisper) pipeline.setWhisper(whisper);
    const f32 = samples instanceof Float32Array ? samples : new Float32Array(samples);
    const prompt = vocabularyPrompt(vocabulary);
    const raw = pipeline.pyWorker() ? await pipeline.dictatePy(f32)
      : pipeline.ggmlModel() ? await pipeline.dictateCpp(f32, { policy, prompt }) : pipeline.dictate(f32, { policy });
    let text = cleanup(raw.text, { voiceCommands });
    let cleanedBy = 'rules';
    if (useLlm && text && settings.ollamaModel) {
      try {
        const t = await llm.cleanupText(text, { host: settings.ollamaHost, model: settings.ollamaModel, timeoutMs: settings.llmTimeoutMs || 45000 });
        if (t) { text = t; cleanedBy = 'llm'; }
      } catch (e) {
        cleanedBy = `rules (språkmodell misslyckades: ${e.message})`;
      }
    }
    return { text, raw: raw.text, languages: raw.languages, cleanedBy };
  },

  // Möte: wavPath -> segment med talare och tidsstämplar.
  async meeting({ wavPath, policy, whisper, diarize, speakerCount, vocabulary }, id) {
    if (whisper) pipeline.setWhisper(whisper);
    const onProgress = (p) => send({ id, progress: p });
    const prompt = vocabularyPrompt(vocabulary);
    if (pipeline.pyWorker()) return pipeline.meetingPy(wavPath, { diarize, speakerCount, onProgress });
    return pipeline.ggmlModel()
      ? pipeline.meetingCpp(wavPath, { policy, diarize, speakerCount, prompt, onProgress })
      : pipeline.meeting(wavPath, { policy, diarize, speakerCount, onProgress });
  },

  async summarize({ segments, useLlm }, id) {
    if (useLlm && settings.ollamaModel) {
      try {
        send({ id, progress: { phase: 'summarize' } });
        const s = await llm.summarize(transcriptAsText(segments), { host: settings.ollamaHost, model: settings.ollamaModel });
        return { ...s, by: 'llm' };
      } catch (e) {
        return { ...heuristicSummary(segments), by: `rules (språkmodell misslyckades: ${e.message})` };
      }
    }
    return { ...heuristicSummary(segments), by: 'rules' };
  },
};

process.on('uncaughtException', (e) => console.error('uncaughtException', e && e.stack ? e.stack : e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e && e.stack ? e.stack : e));

async function handle(msg) {
  const { id, method, params } = msg || {};
  console.error(`[motor] ${method}${params && params.wavPath ? ' ' + params.wavPath : ''}`);
  if (!method || !methods[method]) return send({ id, error: `Okänd metod: ${method}` });
  try {
    const result = await methods[method](params || {}, id);
    send({ id, result });
  } catch (e) {
    console.error(`[motor] fel i ${method}:`, e && e.stack ? e.stack : e);
    send({ id, error: e && e.message ? e.message : String(e) });
  }
}

if (port) port.on('message', (e) => handle(e.data));
else process.on('message', handle);

send({ ready: true });
