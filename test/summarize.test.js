const test = require('node:test');
const assert = require('node:assert');
const { normalizeSummary, heuristicSummary } = require('../src/engine/summarize');
const { assertLocal } = require('../src/engine/llm');

test('normaliserar modellens JSON', () => {
  const s = normalizeSummary({ summary: ' x ', decisions: ['a', { text: 'b' }, ''], todos: ['c', { text: 'd', owner: 'Eva' }, { text: '' }] });
  assert.deepStrictEqual(s, { summary: 'x', decisions: ['a', 'b'], todos: [{ text: 'c' }, { text: 'd', owner: 'Eva' }] });
  assert.deepStrictEqual(normalizeSummary(null), { summary: '', decisions: [], todos: [] });
});

test('regelbaserad reserv hittar beslut och uppgifter', () => {
  const s = heuristicSummary([
    { speaker: 'A', text: 'Då beslutar vi att leverera på fredag. Jag skickar en offert i morgon.' },
    { speaker: 'B', text: 'Great, and I will book the studio for next week.' },
  ]);
  assert.strictEqual(s.decisions.length, 1);
  assert.strictEqual(s.todos.length, 2);
  assert.strictEqual(s.todos[1].owner, 'B');
});

test('språkmodellen får bara vara lokal', () => {
  assertLocal('http://127.0.0.1:11434');
  assertLocal('http://localhost:11434');
  assert.throws(() => assertLocal('https://api.example.com'));
});
