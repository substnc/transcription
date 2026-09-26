'use strict';
// Snabb whisper-motor via whisper.cpp (körs på Macens grafikkrets med Metal).
// Vi startar den medföljande binären whisper-cli som en underprocess och läser dess JSON.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const audio = require('./audio');

// Hittar binären: uttrycklig sökväg (inställning/miljö), paketerad app (Resources/bin), eller repo (resources/bin).
function findBinary(explicit) {
  const candidates = [
    explicit,
    process.env.SPEAK_WHISPER_CLI,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'whisper-cli') : null,
    path.join(__dirname, '..', '..', 'resources', 'bin', 'whisper-cli'),
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// Ordlista -> prompt till whisper.cpp. Whisper tar prompten som "föregående text", så namn och
// facktermer där gör att modellen stavar dem rätt. Ett ord per rad eller kommaseparerat.
// Whisper läser bara de sista ~224 tokens, så listan kapas (från slutet) till en rimlig längd.
const MAX_PROMPT_CHARS = 600;
function vocabularyPrompt(text) {
  const terms = String(text || '').split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  const unique = [...new Set(terms)];
  let out = unique.join(', ');
  while (out.length > MAX_PROMPT_CHARS && unique.length > 1) { unique.pop(); out = unique.join(', '); }
  return out ? out + '.' : '';
}

// Gör om whisper.cpp:s JSON till våra segment.
function parseResult(json) {
  const list = (json && json.transcription) || [];
  return list
    .map((s) => ({ start: (s.offsets.from || 0) / 1000, end: (s.offsets.to || 0) / 1000, text: String(s.text || '').trim() }))
    .filter((s) => s.text);
}

// Kör whisper-cli på en 16 kHz mono WAV. Returnerar [{ start, end, text }].
// greedy: enklare avkodning (utan beam search), används som andra försök om ett stycke fastnar.
// stallMs: om whisper-cli inte rör sig på så här länge avbryts den i stället för att hänga för alltid.
function transcribeWav(wavPath, { binary, model, language = 'auto', threads, onProgress, prompt, greedy = false, stallMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = findBinary(binary);
    if (!bin) return reject(new Error('whisper-cli saknas (Metal-motorn). Installera om appen.'));
    if (!model || !fs.existsSync(model)) return reject(new Error('ggml-modellen saknas.'));
    const out = path.join(os.tmpdir(), `speak-${process.pid}-${Date.now()}`);
    const args = ['-m', model, '-f', wavPath, '-l', language === 'auto' ? 'auto' : language, '-oj', '-of', out, '-np', '-pp',
      '-t', String(threads || Math.max(2, Math.min(8, os.cpus().length))), '-bo', greedy ? '1' : '5', '-bs', greedy ? '1' : '5'];
    if (prompt) args.push('--prompt', prompt);
    const p = spawn(bin, args);
    let err = '';
    let settled = false;
    let watchdog = null;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(watchdog); fn(v); };
    const arm = () => {
      clearTimeout(watchdog);
      // Svara direkt i stället för att vänta på att processen stängs: den kan hänga kvar.
      watchdog = setTimeout(() => {
        p.kill('SIGKILL');
        fs.rmSync(out + '.json', { force: true });
        finish(reject, new Error(`whisper-cli stod still i ${Math.max(1, Math.round(stallMs / 60000))} minuter och avbröts`));
      }, stallMs);
    };
    arm();
    p.stderr.on('data', (d) => {
      arm();
      const s = d.toString();
      err = (err + s).slice(-4000);
      if (onProgress) for (const m of s.matchAll(/progress\s*=\s*(\d+)%/g)) onProgress(Number(m[1]) / 100);
    });
    p.on('error', (e) => finish(reject, e));
    p.on('close', (code) => {
      if (settled) return;
      const file = out + '.json';
      try {
        if (code !== 0) throw new Error(`whisper-cli avslutades med kod ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`);
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        finish(resolve, parseResult(json));
      } catch (e) {
        finish(reject, e);
      } finally {
        fs.rmSync(file, { force: true });
      }
    });
  });
}

// Samma sak för råa samples: skrivs till en temporär WAV först.
async function transcribeSamples(samples, opts) {
  const tmp = path.join(os.tmpdir(), `speak-${process.pid}-${Date.now()}.wav`);
  audio.writeWav(tmp, samples);
  try {
    return await transcribeWav(tmp, opts);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---- Diktering via whisper-server: modellen laddas en gång och ligger kvar ----
// whisper-cli laddar hela modellen vid varje diktering. whisper-server håller den laddad, så en diktering
// blir bara själva transkriberingen. Servern lyssnar bara på 127.0.0.1 (den här datorn), inget går ut.

function findServer(cliPath) {
  const candidates = [
    process.env.SPEAK_WHISPER_SERVER,
    cliPath ? path.join(path.dirname(cliPath), 'whisper-server') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'whisper-server') : null,
    path.join(__dirname, '..', '..', 'resources', 'bin', 'whisper-server'),
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// 16 kHz mono 16-bit WAV i minnet.
function wavBuffer(samples, sampleRate = audio.SAMPLE_RATE) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(x < 0 ? x * 32768 : x * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require('net').createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

class WhisperServer {
  constructor({ binary, model, threads }) {
    this.binary = binary;
    this.model = model;
    this.threads = threads;
    this.proc = null;
    this.ready = null;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.port = await freePort();
      const t0 = Date.now();
      const args = ['-m', this.model, '--host', '127.0.0.1', '--port', String(this.port), '-t', String(this.threads || 4), '-bs', '5', '-bo', '5'];
      const p = spawn(this.binary, args);
      this.proc = p;
      let err = '';
      p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-4000); });
      p.stdout.on('data', () => {});
      p.on('exit', (code) => {
        if (this.proc === p) { this.proc = null; this.ready = null; }
        if (code) console.error(`[motor] whisper-server avslutades (${code}): ${err.trim().split('\n').slice(-2).join(' | ')}`);
      });
      // Vänta tills servern svarar (modellen är då laddad).
      for (let i = 0; i < 600; i++) {
        if (!this.proc) throw new Error(`whisper-server startade inte: ${err.trim().split('\n').slice(-2).join(' | ')}`);
        try {
          const r = await fetch(`http://127.0.0.1:${this.port}/`, { signal: AbortSignal.timeout(1000) });
          if (r.ok) break;
        } catch { /* inte uppe än */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      console.error(`[motor] whisper-server redo på ${((Date.now() - t0) / 1000).toFixed(1)} s (${path.basename(this.model)})`);
    })().catch((e) => { this.stop(); throw e; });
    return this.ready;
  }

  async transcribe(samples, { language = 'auto', prompt } = {}) {
    await this.start();
    const form = new FormData();
    form.append('file', new Blob([wavBuffer(samples)], { type: 'audio/wav' }), 'diktering.wav');
    form.append('response_format', 'verbose_json');
    form.append('language', language === 'auto' ? 'auto' : language);
    form.append('temperature', '0');
    if (prompt) form.append('prompt', prompt);
    const r = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`whisper-server svarade ${r.status}`);
    const json = await r.json();
    if (json.error) throw new Error(`whisper-server: ${json.error}`);
    return (json.segments || [])
      .map((x) => ({ start: Number(x.start) || 0, end: Number(x.end) || 0, text: String(x.text || '').trim() }))
      .filter((x) => x.text);
  }

  stop() {
    const p = this.proc;
    this.proc = null;
    this.ready = null;
    if (p) try { p.kill(); } catch {}
  }
}

module.exports = { findBinary, findServer, WhisperServer, wavBuffer, parseResult, vocabularyPrompt, transcribeWav, transcribeSamples };
