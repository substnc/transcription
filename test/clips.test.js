'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseClips, mergeRanges } = require('../src/engine/llm');

test('klipp: radnummer i fönstret blir index i hela mötet', () => {
  assert.deepStrictEqual(parseClips({ clips: [{ from: 3, to: 7 }] }, 100, 120), [[102, 106]]);
});

test('klipp: orimliga svar hoppas över', () => {
  const bad = { clips: [{ from: 0, to: 4 }, { from: 8, to: 5 }, { from: 2, to: 200 }, { from: 'x', to: 3 }, null] };
  assert.deepStrictEqual(parseClips(bad, 0, 120), []);
  assert.deepStrictEqual(parseClips(null, 0, 120), []);
  assert.deepStrictEqual(parseClips({ clips: 'nej' }, 0, 120), []);
});

test('klipp: överlappande fönster slås ihop till ett klipp', () => {
  assert.deepStrictEqual(mergeRanges([[110, 118], [30, 40], [100, 112], [41, 45]]), [[30, 45], [100, 118]]);
});
