const test = require('node:test');
const assert = require('node:assert');
const { cleanup, isHallucination, tidy } = require('../src/engine/cleanup');

test('tar bort tvekljud och dubbla ord', () => {
  assert.strictEqual(cleanup('eh jag jag tänkte att öhm vi kör på fredag'), 'Jag tänkte att vi kör på fredag');
  assert.strictEqual(cleanup('um so I think, uh, we should ship it.'), 'So I think, we should ship it.');
});

test('lämnar riktiga ord i fred', () => {
  assert.strictEqual(cleanup('det var liksom typ klart.'), 'Det var liksom typ klart.');
  assert.strictEqual(cleanup('ahmed kommer imorgon'), 'Ahmed kommer imorgon');
});

test('röstkommandon ger radbrytningar', () => {
  assert.strictEqual(cleanup('hej ny rad hur mår du nytt stycke bra'), 'Hej\nHur mår du\n\nBra');
  assert.strictEqual(cleanup('hello new line there', { voiceCommands: false }), 'Hello new line there');
});

test('skiljetecken och versaler', () => {
  assert.strictEqual(tidy('hej ,hur mår du ?jag mår bra.bra'), 'Hej, hur mår du? Jag mår bra. Bra');
  assert.strictEqual(tidy('pris 3.5 kr'), 'Pris 3.5 kr');
});

test('hallucinationer filtreras', () => {
  assert.ok(isHallucination('Undertexter av Amara.org'));
  assert.ok(isHallucination('Tack för att du tittade!'));
  assert.ok(isHallucination('Thanks for watching'));
  assert.ok(isHallucination('ha ha ha ha ha ha ha'));
  assert.ok(isHallucination('   '));
  assert.ok(!isHallucination('Vi bestämde att leverera på fredag.'));
});
