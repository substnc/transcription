const test = require('node:test');
const assert = require('node:assert');
const { mergeSimilarSpeakers } = require('../src/engine/merge');

const v = (...x) => Float32Array.from(x);

test('samma röst med två nummer slås ihop till den som pratat mest', () => {
  const map = mergeSimilarSpeakers({
    0: { emb: v(1, 0, 0), sec: 300 },
    1: { emb: v(0, 1, 0), sec: 200 },
    6: { emb: v(0.95, 0.1, 0), sec: 40 }, // "Talare 7" är egentligen talare 0
  });
  assert.strictEqual(map[6], '0');
  assert.strictEqual(map[1], '1');
});

test('olika röster lämnas i fred, och mikrofonen rörs aldrig', () => {
  const map = mergeSimilarSpeakers({ me: { emb: v(1, 0), sec: 100 }, 0: { emb: v(1, 0.01), sec: 50 }, 1: { emb: v(0, 1), sec: 50 } });
  assert.strictEqual(map.me, undefined);
  assert.strictEqual(map[0], '0');
  assert.strictEqual(map[1], '1');
});

test('med angivet antal talare slås de mest lika ihop tills antalet stämmer', () => {
  const map = mergeSimilarSpeakers({
    0: { emb: v(1, 0, 0), sec: 100 }, 1: { emb: v(0, 1, 0), sec: 100 }, 2: { emb: v(0.4, 0.3, 0.87), sec: 10 },
  }, { maxSpeakers: 2 });
  assert.strictEqual(new Set(Object.values(map)).size, 2);
});

test('två lika röster slås inte ihop när du sagt att ni var två', () => {
  const voices = { 0: { emb: v(1, 0, 0), sec: 100 }, 1: { emb: v(0.95, 0.2, 0), sec: 60 } };
  assert.strictEqual(new Set(Object.values(mergeSimilarSpeakers(voices))).size, 1);
  assert.strictEqual(new Set(Object.values(mergeSimilarSpeakers(voices, { maxSpeakers: 2, minSpeakers: 2 }))).size, 2);
});
