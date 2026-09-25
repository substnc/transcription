const test = require('node:test');
const assert = require('node:assert');
const { splitText } = require('../src/engine/llm');

test('långa transkript delas vid radbrytningar utan att tappa text', () => {
  const lines = Array.from({ length: 500 }, (_, i) => `[00:${String(i).padStart(3, '0')}] Talare ${i % 3}: ${'ord '.repeat(40)}`);
  const text = lines.join('\n');
  const parts = splitText(text, 10000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 10000));
  assert.strictEqual(parts.join('\n'), text);
});

test('kort text blir en enda del', () => {
  assert.deepStrictEqual(splitText('hej\nhopp', 1000), ['hej\nhopp']);
});
