const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const models = require('../src/engine/models');
const pianissimo = require('../src/engine/pianissimo');
const { Pipeline } = require('../src/engine/pipeline');
const audio = require('../src/engine/audio');

const FAKE = path.join(__dirname, 'fixtures', 'fake-pianissimo.js');

// En modellmapp där "Python" är ett skript som startar låtsas-arbetaren.
function installedDir() {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-pn-'));
  const dir = path.join(modelsDir, 'pianissimo-sv');
  fs.mkdirSync(path.join(dir, 'venv', 'bin'), { recursive: true });
  const py = path.join(dir, 'venv', 'bin', 'python');
  fs.writeFileSync(py, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}"\n`);
  fs.chmodSync(py, 0o755);
  fs.writeFileSync(path.join(dir, 'installed.json'), '{}');
  fs.writeFileSync(path.join(modelsDir, 'silero_vad.onnx'), Buffer.alloc(200000, 1));
  return modelsDir;
}

// Låtsas-VAD: släpper ett talstycke per 16000 samples.
function fakeSherpa() {
  class Vad {
    constructor() { this.buf = 0; this.pos = 0; this.q = []; }
    acceptWaveform(w) { this.buf += w.length; if (this.buf >= 16000) { this.q.push({ start: this.pos, samples: new Float32Array(16000) }); this.pos += 16000; this.buf -= 16000; } }
    flush() {}
    isEmpty() { return !this.q.length; }
    front() { return this.q[0]; }
    pop() { this.q.shift(); }
  }
  return { Vad };
}

test.after(() => pianissimo.stopAll());

test('Pianissimo räknas som installerad först när miljön och markören finns', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-pn-'));
  assert.strictEqual(models.whisperFiles(empty, 'pianissimo-sv'), null);
  assert.strictEqual(models.status(empty).whisper['pianissimo-sv'].installed, false);
  assert.strictEqual(models.status(empty).whisper['pianissimo-sv'].py, true);
  const dir = installedDir();
  assert.deepStrictEqual(models.whisperFiles(dir, 'pianissimo-sv'), { py: true, dir: path.join(dir, 'pianissimo-sv') });
  assert.ok(pianissimo.workerScript(), 'worker.py finns i repot');
});

test('möte: hela filen med tidsstämplar, segment blir talarturer', async () => {
  const dir = installedDir();
  const wav = path.join(dir, 'm.wav');
  audio.writeWav(wav, new Float32Array(16000 * 3));
  const p = new Pipeline({ modelsDir: dir, whisper: 'pianissimo-sv' });
  assert.ok(p.pyWorker());
  const r = await p.meetingPy(wav, { diarize: false });
  assert.strictEqual(r.engine, 'pianissimo');
  assert.deepStrictEqual(r.languages, ['sv']);
  assert.strictEqual(r.segments.length, 1, 'två korta turer med liten lucka slås ihop');
  assert.match(r.segments[0].text, /fredag.*Anna/);
  assert.strictEqual(r.segments[0].start, 0.2);
});

test('diktering och livetext går via samma arbetare', async () => {
  const dir = installedDir();
  const p = new Pipeline({ modelsDir: dir, whisper: 'pianissimo-sv', sherpa: fakeSherpa() });
  const d = await p.dictatePy(new Float32Array(16000));
  assert.match(d.text, /fredag/);
  await p.liveStart();
  const segs = await p.liveFeed(new Float32Array(20000));
  assert.strictEqual(segs.length, 1);
  assert.deepStrictEqual([segs[0].start, segs[0].end], [0, 1]);
  assert.match(segs[0].text, /fredag/);
  assert.deepStrictEqual(await p.liveStop(), []);
});

test('fel från arbetaren blir ett vanligt fel, och arbetaren lever vidare', async () => {
  const dir = installedDir();
  const w = new pianissimo.Worker(path.join(dir, 'pianissimo-sv'));
  await assert.rejects(w.transcribe('/finns/inte.wav'), /FileNotFoundError/);
  const wav = path.join(dir, 'ok.wav');
  audio.writeWav(wav, new Float32Array(1600));
  assert.match((await w.transcribe(wav)).text, /fredag/);
  w.stop();
});
