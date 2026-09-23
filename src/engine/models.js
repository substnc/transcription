'use strict';
// Modellkatalog och nedladdning. Modeller hämtas EN gång från GitHub (sherpa-onnx releases)
// och lagras lokalt. Det är den enda nätverkstrafiken i appen och den innehåller aldrig ljud eller text.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const pianissimo = require('./pianissimo');

const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

// Alla modeller körs av whisper.cpp på grafikkretsen (Metal). ggml-format i mappar whisper-cpp-<namn>.
// Två i katalogen: turbo för diktering (snabb, laddas ner automatiskt) och KB-Whisper large
// för möten (noggrannast på svenska, importeras från konverteringsjobbet). Importerade modeller visas också.
const WHISPER_MODELS = {
  'turbo-metal': { size: '1.6 GB', note: 'OpenAI whisper large-v3 turbo. Snabb, för diktering. Laddas ner automatiskt.', ggml: true,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin' },
  'kb-large-metal': { size: '3 GB', note: 'KB-Whisper large. Noggrannast på svenska, för möten. Importeras.', manual: true, ggml: true },
  // Körs med NeMo i Python, som modellkortet beskriver. Installeras med en knapp (Python, PyTorch, NeMo, modellen).
  'pianissimo-sv': { size: '4.5 GB', note: 'Klang Pianissimo. Bara svenska, mycket snabb. Körs med NeMo (Python). För livetext och möten.', python: true },
};

// Mappnamn per modelltyp: whisper i ONNX (sherpa) eller whisper i ggml (whisper.cpp).
const PREFIX = /^(sherpa-onnx-whisper-|whisper-cpp-)/;

const AUX_MODELS = {
  vad: {
    label: 'Röstdetektor (Silero VAD)',
    file: 'silero_vad.onnx',
    url: `${RELEASES}/asr-models/silero_vad.onnx`,
    size: '0.6 MB',
  },
  segmentation: {
    label: 'Talarsegmentering (pyannote 3.0)',
    dir: 'sherpa-onnx-pyannote-segmentation-3-0',
    file: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
    url: `${RELEASES}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    size: '6 MB',
  },
  embedding: {
    label: 'Talarigenkänning (3D-Speaker ERes2Net)',
    file: '3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common.onnx',
    url: `${RELEASES}/speaker-recongition-models/3dspeaker_speech_eres2net_base_200k_sv_zh-cn_16k-common.onnx`,
    size: '40 MB',
  },
};

function whisperDir(modelsDir, name) {
  return path.join(modelsDir, `sherpa-onnx-whisper-${name}`);
}
// Modeller för whisper.cpp (Metal) ligger i whisper-cpp-<namn>/ggml-model*.bin
function ggmlDir(modelsDir, name) {
  return path.join(modelsDir, `whisper-cpp-${name}`);
}
// Python-modeller (Pianissimo): egen mapp med Python-miljö, NeMo och modellcache.
function pyDir(modelsDir, name) {
  return path.join(modelsDir, name);
}
function dirFor(modelsDir, folder) {
  const name = folder.replace(PREFIX, '');
  return folder.startsWith('whisper-cpp-') ? ggmlDir(modelsDir, name) : whisperDir(modelsDir, name);
}

function findFile(dir, patterns) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const p of patterns) {
    const hit = files.find((f) => p.test(f));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

// Hittar encoder/decoder/tokens för en whisper-modell. Föredrar full precision (bättre svenska),
// int8 används bara om fp32-filerna saknas.
function whisperFiles(modelsDir, name) {
  if (WHISPER_MODELS[name] && WHISPER_MODELS[name].python) {
    const dir = pyDir(modelsDir, name);
    return pianissimo.isInstalled(dir) ? { py: true, dir } : null;
  }
  const gdir = ggmlDir(modelsDir, name);
  const ggml = findFile(gdir, [/^ggml-model\.bin$/, /^ggml-model-f16\.bin$/, /^ggml-model-q5_0\.bin$/, /^ggml-.*\.bin$/]);
  if (ggml) return { ggml };
  const dir = whisperDir(modelsDir, name);
  const encoder = findFile(dir, [/-encoder\.onnx$/, /-encoder\.int8\.onnx$/]);
  const decoder = findFile(dir, [/-decoder\.onnx$/, /-decoder\.int8\.onnx$/]);
  const tokens = findFile(dir, [/-tokens\.txt$/]);
  if (!encoder || !decoder || !tokens) return null;
  return { encoder, decoder, tokens };
}

function auxPath(modelsDir, key) {
  return path.join(modelsDir, AUX_MODELS[key].file);
}

function status(modelsDir) {
  const whisper = {};
  for (const name of Object.keys(WHISPER_MODELS)) {
    const files = whisperFiles(modelsDir, name);
    whisper[name] = { ...WHISPER_MODELS[name], installed: !!files, ggml: !!(files && files.ggml) || !!WHISPER_MODELS[name].ggml, py: !!WHISPER_MODELS[name].python };
  }
  // Egna importerade modeller som inte finns i katalogen visas också.
  if (fs.existsSync(modelsDir)) {
    for (const f of fs.readdirSync(modelsDir)) {
      const name = f.replace(PREFIX, '');
      const files = PREFIX.test(f) && !whisper[name] ? whisperFiles(modelsDir, name) : null;
      if (files) {
        const ggml = !!files.ggml; // ggml-mappen vinner om flera finns, precis som i motorn
        whisper[name] = { size: '', note: ggml ? 'Importerad modell (Metal).' : 'Importerad modell.', manual: true, ggml, installed: true };
      }
    }
  }
  const aux = {};
  for (const key of Object.keys(AUX_MODELS)) {
    aux[key] = { label: AUX_MODELS[key].label, size: AUX_MODELS[key].size, installed: fs.existsSync(auxPath(modelsDir, key)) };
  }
  return { whisper, aux, nemotron: { installed: nemotronInstalled(modelsDir) }, diarizationReady: aux.segmentation.installed && aux.embedding.installed && aux.vad.installed };
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('För många omdirigeringar'));
    https.get(url, { headers: { 'User-Agent': 'diktera' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume();
        return download(res.headers.location, dest, onProgress, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Nedladdning misslyckades (${res.statusCode}) för ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let done = 0;
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.on('data', (chunk) => {
        done += chunk.length;
        if (onProgress) onProgress({ done, total });
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => {
        fs.renameSync(tmp, dest);
        resolve(dest);
      });
      res.pipe(out);
    }).on('error', reject);
  });
}

function extractTarBz2(archive, targetDir) {
  return new Promise((resolve, reject) => {
    const p = spawn('tar', ['xjf', archive, '-C', targetDir]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar misslyckades: ${err}`))));
    p.on('error', reject);
  });
}

async function installWhisper(modelsDir, name, onProgress) {
  if (!WHISPER_MODELS[name]) throw new Error(`Okänd whisper-modell: ${name}`);
  if (WHISPER_MODELS[name].manual) throw new Error('Den här modellen laddas inte ner automatiskt. Använd Importera modell.');
  fs.mkdirSync(modelsDir, { recursive: true });
  if (WHISPER_MODELS[name].python) {
    await pianissimo.install(pyDir(modelsDir, name), { download, onProgress });
    return;
  }
  if (WHISPER_MODELS[name].ggml) {
    const dir = ggmlDir(modelsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    await download(WHISPER_MODELS[name].url, path.join(dir, 'ggml-model.bin'), onProgress);
    if (!whisperFiles(modelsDir, name)) throw new Error('Modellfilen hittades inte efter nedladdning');
    return;
  }
  const archive = path.join(modelsDir, `sherpa-onnx-whisper-${name}.tar.bz2`);
  await download(`${RELEASES}/asr-models/sherpa-onnx-whisper-${name}.tar.bz2`, archive, onProgress);
  if (onProgress) onProgress({ phase: 'extract' });
  await extractTarBz2(archive, modelsDir);
  fs.rmSync(archive, { force: true });
  // Behåll full precision, ta bort int8-varianten och testfiler för att spara plats.
  const dir = whisperDir(modelsDir, name);
  for (const f of fs.readdirSync(dir)) {
    if (/-(encoder|decoder)\.int8\.onnx$/.test(f) && fs.existsSync(path.join(dir, f.replace('.int8.onnx', '.onnx')))) {
      fs.rmSync(path.join(dir, f));
    }
    if (f === 'test_wavs') fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  }
  if (!whisperFiles(modelsDir, name)) throw new Error('Modellfilerna hittades inte efter uppackning');
}

async function installAux(modelsDir, key, onProgress) {
  const m = AUX_MODELS[key];
  if (!m) throw new Error(`Okänd modell: ${key}`);
  fs.mkdirSync(modelsDir, { recursive: true });
  if (m.url.endsWith('.tar.bz2')) {
    const archive = path.join(modelsDir, `${key}.tar.bz2`);
    await download(m.url, archive, onProgress);
    if (onProgress) onProgress({ phase: 'extract' });
    await extractTarBz2(archive, modelsDir);
    fs.rmSync(archive, { force: true });
  } else {
    await download(m.url, auxPath(modelsDir, key), onProgress);
  }
  if (!fs.existsSync(auxPath(modelsDir, key))) throw new Error('Modellfilen hittades inte efter nedladdning');
}

// Importerar en modellmapp eller .tar.bz2 (t.ex. kb-whisper-large.tar.bz2 från konverteringsjobbet).
async function importWhisper(modelsDir, sourcePath) {
  fs.mkdirSync(modelsDir, { recursive: true });
  const st = fs.statSync(sourcePath);
  if (st.isDirectory()) {
    const base = path.basename(sourcePath);
    const name = base.replace(PREFIX, '');
    const target = dirFor(modelsDir, base);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(sourcePath, target, { recursive: true });
    if (!whisperFiles(modelsDir, name)) { fs.rmSync(target, { recursive: true, force: true }); throw new Error('Mappen innehåller ingen taligenkänningsmodell.'); }
    return name;
  }
  // En ensam ggml-fil (t.ex. ggml-model.bin) läggs i en egen mapp döpt efter filnamnet.
  if (/^ggml-.*\.bin$/.test(path.basename(sourcePath))) {
    const name = path.basename(sourcePath).replace(/^ggml-(model-)?/, '').replace(/\.bin$/, '') || 'egen';
    const target = ggmlDir(modelsDir, name);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(sourcePath, path.join(target, 'ggml-model.bin'));
    return name;
  }
  if (!/\.tar\.bz2$/.test(sourcePath)) throw new Error('Välj en mapp, en .tar.bz2-fil eller en ggml-*.bin-fil.');
  const before = new Set(fs.readdirSync(modelsDir));
  await extractTarBz2(sourcePath, modelsDir);
  const added = fs.readdirSync(modelsDir).filter((f) => !before.has(f) && PREFIX.test(f));
  const name = added.length ? added[0].replace(PREFIX, '') : null;
  if (!name || !whisperFiles(modelsDir, name)) throw new Error('Arkivet innehöll ingen taligenkänningsmodell.');
  return name;
}

function removeWhisper(modelsDir, name) {
  fs.rmSync(whisperDir(modelsDir, name), { recursive: true, force: true });
  fs.rmSync(ggmlDir(modelsDir, name), { recursive: true, force: true });
  if (WHISPER_MODELS[name] && WHISPER_MODELS[name].python) pianissimo.uninstall(pyDir(modelsDir, name), 'asr');
}

// NVIDIA Nemotron 3 Diarization: talarseparering med NeMo, i samma Python-miljö som Pianissimo.
const NEMO_ENV = 'pianissimo-sv';
function nemotronDir(modelsDir) {
  return pyDir(modelsDir, NEMO_ENV);
}
function nemotronInstalled(modelsDir) {
  return pianissimo.isInstalled(nemotronDir(modelsDir), 'diar');
}
function installNemotron(modelsDir, onProgress) {
  fs.mkdirSync(modelsDir, { recursive: true });
  return pianissimo.install(nemotronDir(modelsDir), { download, onProgress, component: 'diar' });
}
function removeNemotron(modelsDir) {
  pianissimo.uninstall(nemotronDir(modelsDir), 'diar');
}

module.exports = { WHISPER_MODELS, AUX_MODELS, whisperFiles, auxPath, status, installWhisper, installAux, importWhisper, removeWhisper, nemotronDir, nemotronInstalled, installNemotron, removeNemotron };
