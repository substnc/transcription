'use strict';
// Körs som en egen process (Electron utilityProcess eller vanlig node-fork) så att tunga
// modellanrop aldrig blockerar menyradsappen. Enkel RPC: { id, method, params } -> { id, result | error }.

const { Pipeline } = require('./pipeline');
const models = require('./models');
const llm = require('./llm');
const { heuristicSummary } = require('./summarize');
const { transcriptAsText } = require('./markdown');
const { cleanup } = require('./cleanup');

let pipeline = null;
let settings = {};

const port = process.parentPort || null;
function send(msg) {
  if (port) port.postMessage(msg);
  else if (process.send) process.send(msg);
}

const methods = {
  async init(p) {
    settings = { ...settings, ...p };
    pipeline = new Pipeline({ modelsDir: settings.modelsDir, whisper: settings.whisper, numThreads: settings.numThreads });
    return models.status(settings.modelsDir);
  },
  async configure(p) {
    settings = { ...settings, ...p };
    if (pipeline && p.whisper) pipeline.setWhisper(p.whisper);
    return true;
  },
  async status() {
    return { ...models.status(settings.modelsDir), loaded: pipeline ? pipeline.loadedWhisper : null };
  },
  async warmup() {
    pipeline.ensureRecognizer();
    pipeline.ensureVad();
    return true;
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
  async removeWhisper({ name }) {
    if (pipeline && pipeline.loadedWhisper === name) { pipeline.recognizer = null; pipeline.loadedWhisper = null; }
    models.removeWhisper(settings.modelsDir, name);
    return models.status(settings.modelsDir);
  },

  // Diktering: samples (Float32Array 16 kHz) -> städad text.
  async dictate({ samples, policy, useLlm, voiceCommands }) {
    const raw = pipeline.dictate(samples instanceof Float32Array ? samples : new Float32Array(samples), { policy });
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
  async meeting({ wavPath, policy, diarize }, id) {
    const r = pipeline.meeting(wavPath, { policy, diarize, onProgress: (p) => send({ id, progress: p }) });
    return r;
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
    send({ id, error: `${method}: ${e && e.stack ? e.stack : String(e)}` });
  }
}

if (port) port.on('message', (e) => handle(e.data));
else process.on('message', handle);

send({ ready: true });
