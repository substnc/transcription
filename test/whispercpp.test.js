const test = require('node:test');
const assert = require('node:assert');
const { parseResult, findBinary } = require('../src/engine/whispercpp');

test('whisper.cpp-json blir segment i sekunder', () => {
  const segs = parseResult({ transcription: [
    { offsets: { from: 940, to: 21160 }, text: ' Hej allihopa.' },
    { offsets: { from: 21160, to: 29000 }, text: '   ' },
    { offsets: { from: 29000, to: 31000 }, text: 'Okej.' },
  ] });
  assert.deepStrictEqual(segs, [{ start: 0.94, end: 21.16, text: 'Hej allihopa.' }, { start: 29, end: 31, text: 'Okej.' }]);
  assert.deepStrictEqual(parseResult(null), []);
});

test('en obefintlig sökväg används aldrig', () => {
  const b = findBinary('/finns/inte');
  assert.ok(b === null || (typeof b === 'string' && b !== '/finns/inte'));
});
