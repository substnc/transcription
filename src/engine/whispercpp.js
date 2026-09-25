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

module.exports = { findBinary, parseResult, vocabularyPrompt, transcribeWav, transcribeSamples };
