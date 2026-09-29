'use strict';
const test = require('node:test');
const assert = require('node:assert');
const q = require('../src/engine/questions');

const seg = (speaker, text, start) => ({ speaker, text, start, end: start + 3 });

test('namn: tilltal och svar två gånger ger namnet direkt', () => {
  const s = [
    seg('Talare 1', 'Som du sa, Per, är början för lång.', 10), seg('Talare 2', 'Ja, vi kortar den.', 14),
    seg('Talare 1', 'Per, kan du boka studion?', 60), seg('Talare 2', 'Absolut, jag bokar tisdag.', 63),
    seg('Talare 2', 'Anna, har du offerten?', 90), seg('Talare 1', 'Den går ut i morgon.', 94),
  ];
  const r = q.buildQuestions({ segments: s, speakers: ['Talare 1', 'Talare 2'] });
  assert.strictEqual(r.autoNames['Talare 2'], 'Per');
  // Anna nämns bara en gång och finns inte i "om mötet": varken namn eller fråga.
  assert.strictEqual(r.autoNames['Talare 1'], undefined);
  assert.ok(!r.questions.some((x) => x.type === 'name' && x.name === 'Anna'));
});

test('namn: ett tilltal med namnet i "om mötet" blir en fråga, inte ett säkert namn', () => {
  const s = [seg('Talare 1', 'Vad tycker du, Anna?', 5), seg('Talare 3', 'Jag gillar det.', 8)];
  const r = q.buildQuestions({ segments: s, speakers: ['Talare 1', 'Talare 3'], about: 'Kickoff med Anna och Per.' });
  assert.deepStrictEqual(r.autoNames, {});
  const nq = r.questions.find((x) => x.type === 'name');
  assert.strictEqual(nq.speaker, 'Talare 3');
  assert.strictEqual(nq.name, 'Anna');
});

test('namn: vanliga ord först i meningen räknas inte', () => {
  assert.deepStrictEqual(q.addressedNames('Okej, då kör vi. Precis, så blir det.'), []);
  assert.deepStrictEqual(q.selfNames('Hej, jag heter Per och jobbar med ljud.'), ['Per']);
});

test('samma person och ord blir frågor', () => {
  const r = q.buildQuestions({
    segments: [seg('Talare 3', 'Hej', 0), seg('Talare 7', 'Hej', 5)],
    speakers: ['Jag', 'Talare 3', 'Talare 7'],
    similar: [{ a: 'Talare 3', b: 'Talare 7', sim: 0.52 }],
    corrections: [{ index: 0, before: 'vi skickar till de lika då i morgon', after: 'Vi skickar till Delicato i morgon.' }],
  });
  assert.deepStrictEqual(r.questions.find((x) => x.type === 'same'), { type: 'same', a: 'Talare 3', b: 'Talare 7', sim: 0.52 });
  assert.deepStrictEqual(r.questions.find((x) => x.type === 'word'), { type: 'word', index: 0, from: 'de lika då', to: 'Delicato' });
});

test('deltagare: två personer i ett videomöte, den andra får namnet direkt', () => {
  const s = [seg('Jag', 'Hej, välkommen.', 0), seg('Talare 1', 'Tack, kul att ses.', 3)];
  const r = q.buildQuestions({ segments: s, speakers: ['Jag', 'Talare 1'], participants: ['Per'] });
  assert.strictEqual(r.autoNames['Talare 1'], 'Per');
  assert.strictEqual(r.questions.length, 0);
});

test('deltagare: flera personer blir en fråga med namnen som knappar, med gissning', () => {
  const s = [
    seg('Talare 1', 'Vad tycker du, Anna?', 0), seg('Talare 2', 'Jag gillar det.', 3),
    seg('Talare 3', 'Ska vi ta budgeten, Olle?', 9), seg('Talare 3', 'Eller efter lunch.', 12),
  ];
  const r = q.buildQuestions({ segments: s, speakers: ['Talare 1', 'Talare 2', 'Talare 3'], participants: ['Per', 'Anna'] });
  const picks = r.questions.filter((x) => x.type === 'pick');
  assert.ok(picks.length >= 1);
  const t2 = picks.find((x) => x.speaker === 'Talare 2');
  assert.strictEqual(t2.guess, 'Anna');
  assert.deepStrictEqual(t2.options, ['Per', 'Anna', 'Jag']);
});
