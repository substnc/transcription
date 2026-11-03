const test = require('node:test');
const assert = require('node:assert');
const { Pipeline } = require('../src/engine/pipeline');

// Ett talstycke ska få med ljudet strax före den punkt där röstdetektorn hörde talet börja.
test('livetextens talstycken får med ljud före starten', () => {
  const p = Object.create(Pipeline.prototype);
  p.live = { hist: new Float32Array(0), histStart: 0 };
  const stream = Float32Array.from({ length: 48000 }, (_, i) => i); // tre sekunder, värdet = position
  p.remember(stream.subarray(0, 16000));
  p.remember(stream.subarray(16000));
  const piece = p.withPreroll({ start: 32000, samples: stream.slice(32000, 40000) });
  assert.strictEqual(piece.samples.length, 6400 + 8000);
  assert.strictEqual(piece.samples[0], 32000 - 6400);
  assert.strictEqual(piece.samples[6400], 32000);
  assert.strictEqual(piece.start, (32000 - 6400) / 16000);
  // I början av inspelningen finns inget före.
  const first = p.withPreroll({ start: 1000, samples: stream.slice(1000, 2000) });
  assert.strictEqual(first.samples[0], 0);
  assert.strictEqual(first.start, 0);
});

test('minnet håller bara de senaste sekunderna', () => {
  const p = Object.create(Pipeline.prototype);
  p.live = { hist: new Float32Array(0), histStart: 0 };
  for (let k = 0; k < 40; k++) p.remember(new Float32Array(16000).fill(k));
  assert.ok(p.live.hist.length <= 22 * 16000);
  assert.strictEqual(p.live.histStart + p.live.hist.length, 40 * 16000);
  assert.strictEqual(p.live.hist[p.live.hist.length - 1], 39);
});
