const test = require('node:test');
const assert = require('node:assert');
const { splitLong, SAMPLE_RATE } = require('../src/engine/pipeline');

test('korta möten delas inte', () => {
  const s = new Float32Array(SAMPLE_RATE * 60 * 10);
  assert.strictEqual(splitLong(s).length, 1);
});

test('långa möten delas i en tyst stund nära varje tiominutersgräns', () => {
  const sec = 60 * 45;
  const s = new Float32Array(SAMPLE_RATE * sec).map((_, i) => Math.sin(i / 7) * 0.3);
  // Tysta sekunder strax före 10- och 20-minutersgränserna.
  for (const t of [590, 1185]) s.fill(0, t * SAMPLE_RATE, (t + 1) * SAMPLE_RATE);
  const parts = splitLong(s);
  assert.ok(parts.length >= 4);
  assert.ok(Math.abs(parts[1].start - 590.5) < 1, `första gränsen i tystnaden, fick ${parts[1].start}`);
  assert.ok(Math.abs(parts[2].start - 1185.5) < 1, `andra gränsen i tystnaden, fick ${parts[2].start}`);
  // Inget ljud tappas eller dubbleras.
  assert.strictEqual(parts.reduce((n, p) => n + p.samples.length, 0), s.length);
  parts.slice(1).forEach((p, i) => assert.ok(Math.abs(p.start - (parts[i].start + parts[i].samples.length / SAMPLE_RATE)) < 1e-6));
});
