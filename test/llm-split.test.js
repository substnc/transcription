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

const { correctLines } = require('../src/engine/llm');
const HOST = 'http://127.0.0.1:11434';
const fakeOllama = (lines) => { global.fetch = async () => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ lines }) } }) }); };

test('korrläsningen rättar hörfel och tar bort upprepad talare', async () => {
  fakeOllama(['1. Talare 1: Vi ses på fredag.', 'Offerten skickas i morgon.']);
  const r = await correctLines([{ speaker: 'Talare 1', text: 'vi ses på fre dag' }, { speaker: 'Jag', text: 'offerten skickas i morgon' }], { host: HOST, model: 'x' });
  assert.deepStrictEqual(r, ['Vi ses på fredag.', 'Offerten skickas i morgon.']);
});

test('korrläsningen litar inte på fel antal rader eller omskrivna rader', async () => {
  fakeOllama(['bara en rad']);
  assert.strictEqual(await correctLines([{ speaker: 'A', text: 'ett' }, { speaker: 'B', text: 'två' }], { host: HOST, model: 'x' }), null);
  fakeOllama(['Här har modellen hittat på en helt ny och mycket längre mening som inte sades.']);
  assert.deepStrictEqual(await correctLines([{ speaker: 'A', text: 'kort rad' }], { host: HOST, model: 'x' }), ['kort rad']);
});
