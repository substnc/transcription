'use strict';
// Ljudhjälpare: WAV-skrivare som kan växa under inspelning, och konvertering av uppladdade filer via ffmpeg.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SAMPLE_RATE = 16000;

function ffmpegPath() {
  let p = require('ffmpeg-static');
  // Inuti en paketerad Electron-app ligger binären i app.asar.unpacked.
  if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) p = p.replace('app.asar', 'app.asar.unpacked');
  return p;
}

// Skriver 16-bit PCM mono WAV. Header skrivs med platshållare och fylls i vid finalize().
class WavWriter {
  constructor(filePath, sampleRate = SAMPLE_RATE) {
    this.filePath = filePath;
    this.sampleRate = sampleRate;
    this.bytes = 0;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.fd = fs.openSync(filePath, 'w');
    fs.writeSync(this.fd, this.header(0));
  }
  header(dataBytes) {
    const b = Buffer.alloc(44);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + dataBytes, 4);
    b.write('WAVE', 8);
    b.write('fmt ', 12);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); // PCM
    b.writeUInt16LE(1, 22); // mono
    b.writeUInt32LE(this.sampleRate, 24);
    b.writeUInt32LE(this.sampleRate * 2, 28);
    b.writeUInt16LE(2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36);
    b.writeUInt32LE(dataBytes, 40);
    return b;
  }
  write(float32) {
    const out = Buffer.alloc(float32.length * 2);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      out.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), i * 2);
    }
    fs.writeSync(this.fd, out);
    this.bytes += out.length;
  }
  get seconds() {
    return this.bytes / 2 / this.sampleRate;
  }
  finalize() {
    fs.writeSync(this.fd, this.header(this.bytes), 0, 44, 0);
    fs.closeSync(this.fd);
    return this.filePath;
  }
}

function writeWav(filePath, float32, sampleRate = SAMPLE_RATE) {
  const w = new WavWriter(filePath, sampleRate);
  w.write(float32);
  return w.finalize();
}

// Läser en 16-bit mono WAV till Float32Array (används av tester och som reserv).
function readWav(filePath) {
  const b = fs.readFileSync(filePath);
  const sampleRate = b.readUInt32LE(24);
  const channels = b.readUInt16LE(22);
  const bits = b.readUInt16LE(34);
  let off = 12;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'data') {
      const n = Math.floor(size / (bits / 8) / channels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = off + 8 + i * channels * (bits / 8);
        out[i] = bits === 16 ? b.readInt16LE(p) / 32768 : b.readInt32LE(p) / 2147483648;
      }
      return { samples: out, sampleRate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('Ingen data-chunk i WAV-filen');
}

// Konverterar valfri ljud-/videofil till 16 kHz mono WAV med ffmpeg (körs lokalt).
function convertToWav(input, output) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!bin) return reject(new Error('ffmpeg saknas'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const p = spawn(bin, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', output]);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(output) : reject(new Error(`ffmpeg misslyckades: ${err.trim()}`))));
  });
}

function concatFloat32(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

module.exports = { SAMPLE_RATE, WavWriter, writeWav, readWav, convertToWav, concatFloat32, ffmpegPath };
