const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { WavWriter, readWav, concatFloat32 } = require('../src/engine/audio');

test('wav skrivs och läses tillbaka', () => {
  const dir = path.join(__dirname, 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'a.wav');
  const w = new WavWriter(f);
  w.write(new Float32Array([0, 0.5, -0.5, 1, -1]));
  w.write(new Float32Array([0.25]));
  assert.ok(Math.abs(w.seconds - 6 / 16000) < 1e-9);
  w.finalize();
  const r = readWav(f);
  assert.strictEqual(r.sampleRate, 16000);
  assert.strictEqual(r.samples.length, 6);
  assert.ok(Math.abs(r.samples[1] - 0.5) < 0.001);
  assert.ok(Math.abs(r.samples[4] + 1) < 0.001);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('concat', () => {
  assert.deepStrictEqual([...concatFloat32([new Float32Array([1, 2]), new Float32Array([3])])], [1, 2, 3]);
});
