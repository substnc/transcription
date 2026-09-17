const test = require('node:test');
const assert = require('node:assert');
const { turnsFromDiarization, assignSpeakers, relabelSpeakers, coalesce } = require('../src/engine/merge');

test('turer slås ihop per talare', () => {
  const t = turnsFromDiarization([
    { start: 0, end: 2, speaker: 1 }, { start: 2.3, end: 4, speaker: 1 }, { start: 4.5, end: 6, speaker: 0 }, { start: 8, end: 9, speaker: 1 },
  ]);
  assert.deepStrictEqual(t, [
    { start: 0, end: 4, speaker: 1 }, { start: 4.5, end: 6, speaker: 0 }, { start: 8, end: 9, speaker: 1 },
  ]);
});

test('talare tilldelas efter största överlapp, annars närmaste', () => {
  const d = [{ start: 0, end: 5, speaker: 0 }, { start: 5, end: 10, speaker: 1 }];
  const a = assignSpeakers([{ start: 1, end: 4, text: 'a' }, { start: 4, end: 9, text: 'b' }, { start: 12, end: 13, text: 'c' }], d);
  assert.deepStrictEqual(a.map((s) => s.speaker), [0, 1, 1]);
});

test('talare får namn i ordning', () => {
  const r = relabelSpeakers([{ speaker: 2, text: 'x' }, { speaker: 0, text: 'y' }, { speaker: 2, text: 'z' }]);
  assert.deepStrictEqual(r.speakers, ['Talare 1', 'Talare 2']);
  assert.deepStrictEqual(r.segments.map((s) => s.speaker), ['Talare 1', 'Talare 2', 'Talare 1']);
});

test('korta segment slås ihop till stycken', () => {
  const c = coalesce([
    { start: 0, end: 2, speaker: 'A', text: 'Hej.', lang: 'sv' }, { start: 2.5, end: 4, speaker: 'A', text: 'Hur mår du?', lang: 'sv' },
    { start: 4.2, end: 5, speaker: 'B', text: 'Bra.', lang: 'sv' },
  ]);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].text, 'Hej. Hur mår du?');
  assert.strictEqual(c[0].end, 4);
});
