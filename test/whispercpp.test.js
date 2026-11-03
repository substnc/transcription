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

const { vocabularyPrompt, boostList, transcribeWav } = require('../src/engine/whispercpp');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('ordlistan blir en kort prompt utan dubbletter', () => {
  assert.strictEqual(vocabularyPrompt(''), '');
  assert.strictEqual(vocabularyPrompt(null), '');
  assert.strictEqual(vocabularyPrompt('sub.stnc\nBerghs\n\n  Berghs \nsonic branding, Anthon'), 'sub.stnc, Berghs, sonic branding, Anthon.');
  const long = Array.from({ length: 200 }, (_, i) => `Term${i}`).join('\n');
  const p = vocabularyPrompt(long);
  assert.ok(p.length <= 601, 'kapas till max 600 tecken');
  assert.ok(p.startsWith('Term0, Term1'), 'de första orden behålls');
});

test('ordlistan blir en lista för Pianissimo (MLX)', () => {
  assert.deepStrictEqual(boostList(''), []);
  assert.deepStrictEqual(boostList('sub.stnc\nBerghs\n\n  Berghs \nsonic branding, Anthon'), ['sub.stnc', 'Berghs', 'sonic branding', 'Anthon']);
  assert.strictEqual(boostList(Array.from({ length: 300 }, (_, i) => `T${i}`).join('\n')).length, 200);
});

test('ordlistan skickas som --prompt till whisper-cli', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-fake-'));
  const fake = path.join(dir, 'whisper-cli');
  // Låtsasbinär: sparar argumenten och skriver en tom JSON-transkribering till -of.
  fs.writeFileSync(fake, `#!/bin/sh
out=""
prev=""
for a in "$@"; do [ "$prev" = "-of" ] && out="$a"; prev="$a"; done
printf '%s\\n' "$@" > "\${out}.args"
echo '{"transcription":[{"offsets":{"from":0,"to":1000},"text":" hej"}]}' > "\${out}.json"
`);
  fs.chmodSync(fake, 0o755);
  const model = path.join(dir, 'ggml-model.bin');
  fs.writeFileSync(model, 'x');
  const wav = path.join(dir, 'in.wav');
  fs.writeFileSync(wav, 'x');
  const segs = await transcribeWav(wav, { binary: fake, model, language: 'sv', prompt: 'Berghs, sub.stnc.' });
  assert.deepStrictEqual(segs, [{ start: 0, end: 1, text: 'hej' }]);
  const argsFile = fs.readdirSync(os.tmpdir()).find((f) => f.startsWith(`speak-${process.pid}-`) && f.endsWith('.args'));
  assert.ok(argsFile, 'argumentfilen skrevs');
  const args = fs.readFileSync(path.join(os.tmpdir(), argsFile), 'utf8').split('\n');
  fs.rmSync(path.join(os.tmpdir(), argsFile));
  assert.strictEqual(args[args.indexOf('--prompt') + 1], 'Berghs, sub.stnc.');
  assert.strictEqual(args[args.indexOf('-l') + 1], 'sv');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('whisper-cli som står still avbryts i stället för att hänga', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-stall-'));
  const fake = path.join(dir, 'whisper-cli');
  fs.writeFileSync(fake, '#!/bin/sh\nsleep 30\n');
  fs.chmodSync(fake, 0o755);
  const model = path.join(dir, 'ggml-model.bin');
  fs.writeFileSync(model, 'x');
  const t0 = Date.now();
  await assert.rejects(transcribeWav(model, { binary: fake, model, stallMs: 300 }), /stod still/);
  assert.ok(Date.now() - t0 < 5000, 'avbröts snabbt');
  fs.rmSync(dir, { recursive: true, force: true });
});
