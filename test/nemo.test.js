const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const models = require('../src/engine/models');
const { Pipeline, hotwordsFrom } = require('../src/engine/pipeline');

function tmpModels() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-models-'));
  const n = path.join(dir, 'sherpa-onnx-nemo-pianissimo-sv');
  fs.mkdirSync(n);
  for (const f of ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx']) fs.writeFileSync(path.join(n, f), Buffer.alloc(200000, 1));
  fs.writeFileSync(path.join(n, 'tokens.txt'), 'a 0\n<blk> 1\n');
  fs.writeFileSync(path.join(n, 'bpe.vocab'), 'a\t-1\n');
  fs.writeFileSync(path.join(dir, 'silero_vad.onnx'), Buffer.alloc(200000, 1));
  return dir;
}

// Låtsas-sherpa: VAD som släpper ett talstycke per 16000 samples, igenkännare som minns sin konfiguration.
function fakeSherpa() {
  const made = [];
  class Vad {
    constructor() { this.buf = 0; this.pos = 0; this.q = []; }
    acceptWaveform(w) { this.buf += w.length; if (this.buf >= 16000) { this.q.push({ start: this.pos, samples: new Float32Array(16000) }); this.pos += 16000; this.buf -= 16000; } }
    flush() {}
    isEmpty() { return !this.q.length; }
    front() { return this.q[0]; }
    pop() { this.q.shift(); }
    reset() {}
  }
  class OfflineRecognizer {
    constructor(cfg) { this.cfg = cfg; made.push(this); }
    createStream(hw) { return { hw, acceptWaveform() {} }; }
    decode() {}
    getResult(st) { return { text: `hej${st.hw ? ' [' + st.hw + ']' : ''}` }; }
  }
  return { Vad, OfflineRecognizer, made };
}

test('NeMo-mapp hittas som modell och visas i katalogen', () => {
  const dir = tmpModels();
  const f = models.whisperFiles(dir, 'pianissimo-sv');
  assert.ok(f.nemo);
  assert.match(f.encoder, /encoder\.int8\.onnx$/);
  assert.match(f.bpeVocab, /bpe\.vocab$/);
  const st = models.status(dir);
  assert.ok(st.whisper['pianissimo-sv'].installed);
  assert.ok(st.whisper['pianissimo-sv'].nemo);
  models.removeWhisper(dir, 'pianissimo-sv');
  assert.strictEqual(models.whisperFiles(dir, 'pianissimo-sv'), null);
});

test('ordlistan blir hotwords', () => {
  assert.strictEqual(hotwordsFrom(''), '');
  assert.strictEqual(hotwordsFrom('sub.stnc\nBerghs, Berghs\n  Anthon '), 'sub.stnc/Berghs/Anthon');
});

test('NeMo-modell laddas som transducer, med beam search bara när ordlista finns', () => {
  const dir = tmpModels();
  const s = fakeSherpa();
  const p = new Pipeline({ modelsDir: dir, whisper: 'pianissimo-sv', sherpa: s });
  let r = p.decodeWithPolicy(new Float32Array(16000), { language: 'auto' });
  assert.deepStrictEqual(r, { text: 'hej', lang: 'sv' });
  assert.strictEqual(s.made[0].cfg.modelConfig.modelType, 'nemo_transducer');
  assert.strictEqual(s.made[0].cfg.decodingMethod, 'greedy_search');
  p.setHotwords('Berghs\nKlang');
  r = p.decodeWithPolicy(new Float32Array(16000), { language: 'en' });
  assert.strictEqual(r.text, 'hej [Berghs/Klang]');
  assert.strictEqual(s.made[1].cfg.decodingMethod, 'modified_beam_search');
  assert.match(s.made[1].cfg.modelConfig.bpeVocab, /bpe\.vocab$/);
});

test('livetext: ljud i bitar ger färdiga talstycken med tider', async () => {
  const dir = tmpModels();
  const p = new Pipeline({ modelsDir: dir, whisper: 'pianissimo-sv', sherpa: fakeSherpa() });
  p.liveStart();
  assert.deepStrictEqual(await p.liveFeed(new Float32Array(10000)), []);
  const segs = await p.liveFeed(new Float32Array(30000));
  assert.strictEqual(segs.length, 2);
  assert.deepStrictEqual(segs.map((x) => [x.start, x.end, x.text]), [[0, 1, 'Hej'], [1, 2, 'Hej']]);
  assert.deepStrictEqual(await p.liveStop(), []);
  assert.deepStrictEqual(await p.liveFeed(new Float32Array(20000)), [], 'efter stopp tas inget emot');
});
