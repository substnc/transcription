'use strict';
// Klang Pianissimo körs som modellkortet på Hugging Face beskriver: Python + PyTorch + nemo_toolkit[asr],
// ASRModel.from_pretrained("KlangAI/pianissimo-sv") och model.transcribe(...). Ingen omvandling av modellen.
//
// Installation (en gång, startas från Inställningar): uv (Astrals Python-verktyg) hämtar en egen Python 3.11,
// skapar en miljö och installerar torch och nemo_toolkit[asr]. Sedan hämtas modellen till en lokal cache.
// Därefter körs allt utan nät (HF_HUB_OFFLINE=1). Ljud och text lämnar aldrig datorn.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const audio = require('./audio');

const MODEL = 'KlangAI/pianissimo-sv';
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

function isInstalled(dir) {
  const l = layout(dir);
  return fs.existsSync(l.marker) && fs.existsSync(l.python);
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
async function install(dir, { download, onProgress = () => {} } = {}) {
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

  step('Installerar PyTorch och NeMo (cirka 2 GB, tar några minuter)…');
  await run(l.uv, ['pip', 'install', '--python', l.python, ...PACKAGES], {
    env,
    onLine: (line) => { if (/^(Downloading|Installed|Prepared|Resolved)/.test(line)) onProgress({ phase: 'setup', text: `Installerar: ${line}` }); },
  });

  step('Hämtar Pianissimo från Hugging Face (2,5 GB)…');
  await run(l.python, ['-c', `from huggingface_hub import snapshot_download; print(snapshot_download("${MODEL}"))`], { env });

  step('Provkör modellen…');
  const w = new Worker(dir);
  try {
    const info = await w.start();
    step(`Klar. Modellen laddades på ${info.load_sec} s.`);
  } finally {
    w.stop();
  }

  fs.rmSync(env.UV_CACHE_DIR, { recursive: true, force: true });
  fs.writeFileSync(l.marker, JSON.stringify({ model: MODEL, python: PYTHON_VERSION, packages: PACKAGES, installedAt: new Date().toISOString() }, null, 2));
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
          if (msg.ready) { console.error(`[pianissimo] modellen laddad på ${msg.load_sec} s (${msg.device})`); resolve(msg); } else reject(new Error(`Pianissimo kunde inte starta: ${msg.error}`));
          return;
        }
        const job = this.pending.get(msg.id);
        if (!job) return;
        this.pending.delete(msg.id);
        if (msg.ok) job.resolve(msg); else job.reject(new Error(`Pianissimo: ${msg.error}`));
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

  async transcribe(wavPath, { timestamps = false } = {}) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, path: wavPath, timestamps }) + '\n');
    });
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

module.exports = { MODEL, layout, isInstalled, install, Worker, worker, stopAll, workerScript };
