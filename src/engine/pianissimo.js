'use strict';
// NeMo-modeller körs som modellkorten på Hugging Face beskriver: Python + PyTorch + nemo_toolkit[asr].
//   asr:  Klang Pianissimo (KlangAI/pianissimo-sv), ASRModel.from_pretrained(...).transcribe(...)
//   diar: NVIDIA Nemotron 3 Diarization (nvidia/Nemotron-3-Diarization), SortformerEncLabelModel.diarize(...)
// Ingen omvandling av modellerna. Båda delar samma Python-miljö (mappen models/pianissimo-sv).
//
// Installation (en gång per komponent, startas från Inställningar): uv (Astrals Python-verktyg) hämtar en
// egen Python, skapar en miljö och installerar torch och nemo_toolkit[asr]. Sedan hämtas modellen till en
// lokal cache. Därefter körs allt utan nät (HF_HUB_OFFLINE=1). Ljud och text lämnar aldrig datorn.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const audio = require('./audio');

const MODEL = 'KlangAI/pianissimo-sv';
const COMPONENTS = {
  asr: { repo: 'KlangAI/pianissimo-sv', label: 'Pianissimo' },
  diar: { repo: 'nvidia/Nemotron-3-Diarization', label: 'Nemotron 3 Diarization' },
};
const PYTHON_VERSION = '3.11';
const PACKAGES = ['torch', 'nemo_toolkit[asr]'];

function layout(dir) {
  return {
    dir,
    uv: path.join(dir, 'uv', 'uv'),
    python: path.join(dir, 'venv', 'bin', 'python'),
    hfHome: path.join(dir, 'hf'),
    marker: path.join(dir, 'installed.json'),
  };
}

function readMarker(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(layout(dir).marker, 'utf8'));
    return { ...m, components: m.components || ['asr'] }; // äldre installationer hade bara Pianissimo
  } catch {
    return null;
  }
}

function isInstalled(dir, component = 'asr') {
  const m = readMarker(dir);
  return !!(m && fs.existsSync(layout(dir).python) && m.components.includes(component));
}

// Var arbetarskriptet ligger: paketerad app (Resources/pianissimo) eller repot (resources/pianissimo).
function workerScript() {
  const candidates = [
    process.env.SPEAK_PIANISSIMO_WORKER,
    process.resourcesPath ? path.join(process.resourcesPath, 'pianissimo', 'worker.py') : null,
    path.join(__dirname, '..', '..', 'resources', 'pianissimo', 'worker.py'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function uvTarget() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  return process.platform === 'darwin' ? `uv-${arch}-apple-darwin` : `uv-${arch}-unknown-linux-gnu`;
}

function run(cmd, args, { env, onLine } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env } });
    let tail = '';
    const feed = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      if (onLine) for (const l of s.split(/\r?\n/)) if (l.trim()) onLine(l.trim());
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} avslutades med kod ${code}: ${tail.split('\n').slice(-5).join(' | ')}`))));
  });
}

// download(url, dest, onProgress) skickas in från models.js för att inte skapa ett cirkulärt beroende.
async function install(dir, { download, onProgress = () => {}, component = 'asr' } = {}) {
  const comp = COMPONENTS[component];
  if (!comp) throw new Error(`Okänd komponent: ${component}`);
  const l = layout(dir);
  fs.mkdirSync(dir, { recursive: true });
  const step = (text) => { console.error(`[pianissimo] ${text}`); onProgress({ phase: 'setup', text }); };
  const env = {
    UV_PYTHON_INSTALL_DIR: path.join(dir, 'python'),
    UV_CACHE_DIR: path.join(dir, 'uv-cache'),
    UV_NO_CONFIG: '1',
    HF_HOME: l.hfHome,
    HF_HUB_DISABLE_TELEMETRY: '1',
  };

  if (!fs.existsSync(l.uv)) {
    step('Hämtar installationsverktyget uv…');
    const tgz = path.join(dir, 'uv.tar.gz');
    await download(`https://github.com/astral-sh/uv/releases/latest/download/${uvTarget()}.tar.gz`, tgz, (p) => onProgress({ phase: 'setup', text: 'Hämtar installationsverktyget uv…', ...p }));
    fs.mkdirSync(path.dirname(l.uv), { recursive: true });
    await run('tar', ['xzf', tgz, '-C', path.dirname(l.uv), '--strip-components', '1']);
    fs.rmSync(tgz, { force: true });
  }

  if (!fs.existsSync(l.python)) {
    step(`Skapar en egen Python ${PYTHON_VERSION}…`);
    await run(l.uv, ['venv', '--python', PYTHON_VERSION, '--python-preference', 'only-managed', path.join(dir, 'venv')], { env });
  }

  step('Installerar PyTorch och NeMo (cirka 2 GB första gången, tar några minuter)…');
  // --upgrade så att en befintlig miljö får en NeMo-version som klarar den nya modellen.
  await run(l.uv, ['pip', 'install', '--upgrade', '--python', l.python, ...PACKAGES], {
    env,
    onLine: (line) => { if (/^(Downloading|Installed|Prepared|Resolved)/.test(line)) onProgress({ phase: 'setup', text: `Installerar: ${line}` }); },
  });

  step(`Hämtar ${comp.label} från Hugging Face…`);
  await run(l.python, ['-c', `from huggingface_hub import snapshot_download; print(snapshot_download("${comp.repo}"))`], { env });

  step(`Provkör ${comp.label}…`);
  stopAll(); // en arbetare som redan kör kan ha en äldre NeMo laddad
  const w = new Worker(dir);
  try {
    await w.start();
    const r = await w.load(component);
    step(`Klar. ${comp.label} laddades på ${r.load_sec} s.`);
  } finally {
    w.stop();
  }

  fs.rmSync(env.UV_CACHE_DIR, { recursive: true, force: true });
  const prev = readMarker(dir);
  const components = [...new Set([...(prev ? prev.components : []), component])];
  fs.writeFileSync(l.marker, JSON.stringify({ components, python: PYTHON_VERSION, packages: PACKAGES, installedAt: new Date().toISOString() }, null, 2));
}

// Tar bort en komponent. Den delade Python-miljön tas bort först när ingen komponent finns kvar.
function uninstall(dir, component) {
  stopAll();
  const m = readMarker(dir);
  const rest = m ? m.components.filter((c) => c !== component) : [];
  if (!rest.length) return fs.rmSync(dir, { recursive: true, force: true });
  const repo = COMPONENTS[component].repo.replace('/', '--');
  fs.rmSync(path.join(layout(dir).hfHome, 'hub', `models--${repo}`), { recursive: true, force: true });
  fs.writeFileSync(layout(dir).marker, JSON.stringify({ ...m, components: rest }, null, 2));
}

// ---- Arbetaren: en Python-process som har modellen laddad ----
class Worker {
  constructor(dir, { threads, command, args } = {}) {
    const l = layout(dir);
    this.dir = dir;
    this.command = command || l.python;
    this.args = args || [workerScript()];
    this.env = { HF_HOME: l.hfHome, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONUNBUFFERED: '1', SPEAK_THREADS: String(threads || Math.max(2, Math.min(8, os.cpus().length - 2))) };
    this.proc = null;
    this.readyPromise = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  start() {
    if (this.readyPromise) return this.readyPromise;
    if (!this.args[0]) return Promise.reject(new Error('Pianissimo-arbetaren (worker.py) saknas i appen.'));
    this.readyPromise = new Promise((resolve, reject) => {
      const p = spawn(this.command, this.args, { env: { ...process.env, ...this.env } });
      this.proc = p;
      let stderrTail = '';
      p.stderr.on('data', (d) => { const s = d.toString(); stderrTail = (stderrTail + s).slice(-3000); process.stderr.write(s); });
      readline.createInterface({ input: p.stdout }).on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if ('ready' in msg) {
          if (msg.ready) { console.error(`[nemo] arbetaren redo på ${msg.import_sec} s (${msg.device}, torch ${msg.torch})`); resolve(msg); } else reject(new Error(`NeMo-arbetaren kunde inte starta: ${msg.error}`));
          return;
        }
        const job = this.pending.get(msg.id);
        if (!job) return;
        this.pending.delete(msg.id);
        if (msg.ok) job.resolve(msg); else job.reject(new Error(`NeMo: ${msg.error}`));
      });
      p.on('error', (e) => { this.reset(); reject(e); });
      p.on('close', (code) => {
        const err = new Error(`Pianissimo-arbetaren avslutades (kod ${code}). ${stderrTail.trim().split('\n').slice(-3).join(' | ')}`);
        for (const job of this.pending.values()) job.reject(err);
        this.pending.clear();
        this.reset();
        reject(err);
      });
    });
    return this.readyPromise;
  }

  reset() {
    this.proc = null;
    this.readyPromise = null;
  }

  async request(msg) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, ...msg }) + '\n');
    });
  }

  // Laddar en modell i förväg ('asr' eller 'diar'), så att första riktiga uppdraget går fort.
  load(what) {
    return this.request({ cmd: 'load', what });
  }

  transcribe(wavPath, { timestamps = false } = {}) {
    return this.request({ cmd: 'transcribe', path: wavPath, timestamps });
  }

  // Nemotron 3 Diarization på en hel fil. Returnerar [{ start, end, speaker }].
  async diarize(wavPath) {
    return (await this.request({ cmd: 'diarize', path: wavPath })).segments || [];
  }

  async transcribeSamples(samples, opts) {
    const tmp = path.join(os.tmpdir(), `speak-pn-${process.pid}-${Date.now()}-${this.nextId}.wav`);
    audio.writeWav(tmp, samples);
    try {
      return await this.transcribe(tmp, opts);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  stop() {
    if (this.proc) { this.proc.stdin.end(); this.proc.kill(); }
    this.reset();
  }
}

// En arbetare per installation, delad mellan möten och livetext så att modellen bara laddas en gång.
const workers = new Map();
function worker(dir) {
  if (!workers.has(dir)) workers.set(dir, new Worker(dir));
  return workers.get(dir);
}
function stopAll() {
  for (const w of workers.values()) w.stop();
  workers.clear();
}

module.exports = { MODEL, COMPONENTS, layout, isInstalled, install, uninstall, Worker, worker, stopAll, workerScript };
