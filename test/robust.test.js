'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isHallucination } = require('../src/engine/cleanup');
const audio = require('../src/engine/audio');

test('hallucinationer: korta fraser bort, riktigt tal med webbadress eller stora tal kvar', () => {
  assert.strictEqual(isHallucination('Tack för att du tittade!'), true);
  assert.strictEqual(isHallucination('Textning Stina Hedin www.btistudios.com'), true);
  assert.strictEqual(isHallucination('ha ha ha ha ha ha ha'), true);
  assert.strictEqual(isHallucination('Gå till www.substnc.se så ser ni hela kampanjen där.'), false);
  assert.strictEqual(isHallucination('Budgeten är 1000000 kronor för hela projektet i år.'), false);
});

test('avbruten inspelning: läses och lagas trots att huvudet säger 0 byte', () => {
  const f = path.join(os.tmpdir(), `speak-test-${process.pid}.wav`);
  const w = new audio.WavWriter(f);
  w.write(new Float32Array(1600).fill(0.25));
  // Ingen finalize(): som efter en krasch.
  fs.closeSync(w.fd);
  assert.strictEqual(audio.readWav(f).samples.length, 1600);
  assert.strictEqual(audio.repairWav(f), true);
  assert.strictEqual(fs.readFileSync(f).readUInt32LE(40), 3200);
  assert.strictEqual(audio.repairWav(f), false);
  fs.rmSync(f, { force: true });
});
