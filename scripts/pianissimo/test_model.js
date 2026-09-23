// Testar en konverterad Pianissimo-mapp genom appens egen motor (samma kod som i Speak).
// Användning: node scripts/pianissimo/test_model.js <modellmapp-med-sherpa-onnx-nemo-*> <tts-mapp>
const fs = require('fs');
const path = require('path');
const sherpa = require('sherpa-onnx-node');
const { writeWav } = require('../../src/engine/audio');
const { Pipeline } = require('../../src/engine/pipeline');

const [modelsDir, ttsDir] = process.argv.slice(2);
const name = fs.readdirSync(modelsDir).find((f) => f.startsWith('sherpa-onnx-nemo-')).replace('sherpa-onnx-nemo-', '');

// Svenskt tal från lokal TTS: tre meningar med paus emellan.
const tts = new sherpa.OfflineTts({ model: { vits: { model: `${ttsDir}/sv_SE-nst-medium.onnx`, tokens: `${ttsDir}/tokens.txt`, dataDir: `${ttsDir}/espeak-ng-data` }, numThreads: 2, debug: 0, provider: 'cpu' }, maxNumSentences: 1 });
const sentences = [
  'Vi bestämde att leverera ljudet till kampanjen på fredag.',
  'Anna tar kontakt med byrån och bokar studion i Stockholm.',
  'Budgeten för projektet är fyrtiotusen kronor.',
];
const parts = [];
for (const t of sentences) {
  const a = tts.generate({ text: t, sid: 0, speed: 1.0 });
  parts.push(new sherpa.LinearResampler(a.sampleRate, 16000).resample(a.samples, true), new Float32Array(16000));
}
const total = parts.reduce((n, p) => n + p.length, 0);
const samples = new Float32Array(total);
let o = 0;
for (const p of parts) { samples.set(p, o); o += p.length; }
writeWav('tts.wav', samples);
console.log(`ljud: ${(total / 16000).toFixed(1)} s`);

(async () => {
  const p = new Pipeline({ modelsDir, whisper: name, sherpa });
  const m = p.meeting('tts.wav', { diarize: false, policy: { language: 'sv' } });
  const text = m.segments.map((s) => s.text).join(' ');
  console.log(`[${name}] möte (${m.timing.speed.toFixed(1)}× realtid):`, text);
  for (const w of ['fredag', 'Stockholm']) if (!text.includes(w)) throw new Error(`"${w}" saknas i texten`);

  p.setHotwords('Anna\nbyrån');
  const h = p.meeting('tts.wav', { diarize: false, policy: { language: 'sv' } });
  console.log(`[${name}] med ordlista:`, h.segments.map((s) => s.text).join(' '));

  const live = new Pipeline({ modelsDir, whisper: name, sherpa });
  live.liveStart();
  const got = [];
  for (let i = 0; i < samples.length; i += 16000) got.push(...(await live.liveFeed(samples.subarray(i, i + 16000))));
  got.push(...(await live.liveStop()));
  console.log(`[${name}] livetext:`, got.map((s) => `[${s.start.toFixed(1)}] ${s.text}`).join(' | '));
  if (got.length < 2) throw new Error('livetexten gav för få talstycken');
})().catch((e) => { console.error(e); process.exit(1); });
