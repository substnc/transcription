// Installerar Pianissimo med appens egen kod och kör möte, diktering och livetext på svenskt TTS-tal.
// Körs i CI på en Apple Silicon-Mac: node scripts/test-pianissimo.js <modellmapp> <tts-mapp>
const fs = require('fs');
const path = require('path');
const sherpa = require('sherpa-onnx-node');
const models = require('../src/engine/models');
const pianissimo = require('../src/engine/pianissimo');
const { Pipeline } = require('../src/engine/pipeline');
const { writeWav } = require('../src/engine/audio');

const [modelsDir, ttsDir] = process.argv.slice(2).map((p) => path.resolve(p));

function tts(sentences) {
  const t = new sherpa.OfflineTts({ model: { vits: { model: `${ttsDir}/sv_SE-nst-medium.onnx`, tokens: `${ttsDir}/tokens.txt`, dataDir: `${ttsDir}/espeak-ng-data` }, numThreads: 2, debug: 0, provider: 'cpu' }, maxNumSentences: 1 });
  const parts = [];
  for (const s of sentences) {
    const a = t.generate({ text: s, sid: 0, speed: 1.0 });
    parts.push(new sherpa.LinearResampler(a.sampleRate, 16000).resample(a.samples, true), new Float32Array(12000));
  }
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

(async () => {
  let t = Date.now();
  await models.installWhisper(modelsDir, 'pianissimo-sv', (p) => { if (p.text) console.log('  ', p.text); });
  console.log(`installation: ${((Date.now() - t) / 1000).toFixed(0)} s`);
  if (!models.whisperFiles(modelsDir, 'pianissimo-sv')) throw new Error('räknas inte som installerad');
  fs.copyFileSync('silero_vad.onnx', path.join(modelsDir, 'silero_vad.onnx'));

  const sentences = [
    'Vi bestämde att leverera ljudet till kampanjen på fredag.',
    'Anna tar kontakt med byrån och bokar studion i Stockholm.',
    'Budgeten för projektet är fyrtiotusen kronor.',
  ];
  const short = tts(sentences);
  const long = tts(Array.from({ length: 12 }, (_, i) => sentences[i % 3]));
  writeWav('short.wav', short);
  writeWav('long.wav', long);

  const p = new Pipeline({ modelsDir, whisper: 'pianissimo-sv', sherpa });
  t = Date.now();
  const m = await p.meetingPy('short.wav', { diarize: false });
  const text = m.segments.map((s) => s.text).join(' ');
  console.log(`möte, kort (${(short.length / 16000).toFixed(1)} s ljud, ${((Date.now() - t) / 1000).toFixed(1)} s inkl. modelladdning):`, text);
  for (const w of ['fredag', 'Stockholm']) if (!text.includes(w)) throw new Error(`"${w}" saknas`);

  const l = await p.meetingPy('long.wav', { diarize: false });
  console.log(`möte, långt: ${l.durationSec.toFixed(1)} s ljud på ${l.timing.transcribeSec.toFixed(1)} s (${l.timing.speed.toFixed(1)}× realtid), ${l.segments.length} turer`);
  console.log('  första turen:', l.segments[0] && l.segments[0].text);

  t = Date.now();
  const d = await p.dictatePy(short.subarray(0, 16000 * 4));
  console.log(`diktering (4 s ljud) på ${((Date.now() - t) / 1000).toFixed(2)} s:`, d.text);

  const live = new Pipeline({ modelsDir, whisper: 'pianissimo-sv', sherpa });
  await live.liveStart();
  const got = [];
  for (let i = 0; i < short.length; i += 16000) got.push(...(await live.liveFeed(short.subarray(i, i + 16000))));
  got.push(...(await live.liveStop()));
  console.log('livetext:', got.map((s) => `[${s.start.toFixed(1)}] ${s.text}`).join(' | '));
  if (got.length < 2) throw new Error('för få talstycken i livetexten');
  pianissimo.stopAll();
})().catch((e) => { console.error(e); pianissimo.stopAll(); process.exit(1); });
