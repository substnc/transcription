'use strict';
// Modellkatalog och nedladdning. Modeller hämtas EN gång från GitHub (sherpa-onnx releases)
// och lagras lokalt. Det är den enda nätverkstrafiken i appen och den innehåller aldrig ljud eller text.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

const WHISPER_MODELS = {
  tiny: { size: '110 MB', note: 'Bara för test. Dålig på svenska.' },
  base: { size: '150 MB', note: 'Snabb, osäker på svenska.' },
  small: { size: '1 GB', note: 'Rimlig kvalitet på svenska. Bra start.' },
  medium: { size: '3 GB', note: 'Bra kvalitet, långsammare.' },
  turbo: { size: '1.6 GB', note: 'Large-v3 turbo. Bäst balans mellan kvalitet och fart.' },
  'large-v3': { size: '6 GB', note: 'Bäst kvalitet, långsammast.' },
  'kb-large': { size: '6 GB', note: 'KB-Whisper large: svensktränad av Kungliga biblioteket. Bäst på svenska. Importeras manuellt.', manual: true },
  'kb-medium': { size: '3 GB', note: 'KB-Whisper medium, svensktränad. Importeras manuellt.', manual: true },
  'kb-small': { size: '1 GB', note: 'KB-Whisper small, svensktränad och snabb. Importeras manuellt.', manual: true },
};

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
    whisper[name] = { ...WHISPER_MODELS[name], installed: !!whisperFiles(modelsDir, name) };
  }
  // Egna importerade modeller som inte finns i katalogen visas också.
  if (fs.existsSync(modelsDir)) {
    for (const f of fs.readdirSync(modelsDir)) {
      const name = f.replace(/^sherpa-onnx-whisper-/, '');
      if (f.startsWith('sherpa-onnx-whisper-') && !whisper[name] && whisperFiles(modelsDir, name)) {
        whisper[name] = { size: '', note: 'Importerad modell.', manual: true, installed: true };
      }
    }
  }
  const aux = {};
  for (const key of Object.keys(AUX_MODELS)) {
    aux[key] = { label: AUX_MODELS[key].label, size: AUX_MODELS[key].size, installed: fs.existsSync(auxPath(modelsDir, key)) };
  }
  return { whisper, aux, diarizationReady: aux.segmentation.installed && aux.embedding.installed && aux.vad.installed };
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
    const name = path.basename(sourcePath).replace(/^sherpa-onnx-whisper-/, '');
    const target = whisperDir(modelsDir, name);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(sourcePath, target, { recursive: true });
    if (!whisperFiles(modelsDir, name)) { fs.rmSync(target, { recursive: true, force: true }); throw new Error('Mappen innehåller ingen whisper-modell (encoder, decoder, tokens).'); }
    return name;
  }
  if (!/\.tar\.bz2$/.test(sourcePath)) throw new Error('Välj en mapp eller en .tar.bz2-fil.');
  const before = new Set(fs.readdirSync(modelsDir));
  await extractTarBz2(sourcePath, modelsDir);
  const added = fs.readdirSync(modelsDir).filter((f) => !before.has(f) && f.startsWith('sherpa-onnx-whisper-'));
  const name = added.length ? added[0].replace(/^sherpa-onnx-whisper-/, '') : null;
  if (!name || !whisperFiles(modelsDir, name)) throw new Error('Arkivet innehöll ingen whisper-modell.');
  return name;
}

function removeWhisper(modelsDir, name) {
  fs.rmSync(whisperDir(modelsDir, name), { recursive: true, force: true });
}

module.exports = { WHISPER_MODELS, AUX_MODELS, whisperFiles, auxPath, status, installWhisper, installAux, importWhisper, removeWhisper };
