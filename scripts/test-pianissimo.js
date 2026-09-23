// Installerar Pianissimo och Nemotron 3 Diarization med appens egen kod och kör dem genom appens motor:
// möte, diktering, livetext, talare från två kanaler och talarseparering av två olika röster.
// Körs i CI på en Apple Silicon-Mac: node scripts/test-pianissimo.js <modellmapp> <svensk-tts> <engelsk-tts-flera-röster>
const fs = require('fs');
const path = require('path');
const sherpa = require('sherpa-onnx-node');
const models = require('../src/engine/models');
const pianissimo = require('../src/engine/pianissimo');
const { Pipeline } = require('../src/engine/pipeline');
const { writeWav } = require('../src/engine/audio');

const [modelsDir, ttsDir, multiDir] = process.argv.slice(2).map((p) => path.resolve(p));

function makeTts(dir, file) {
  return new sherpa.OfflineTts({ model: { vits: { model: `${dir}/${file}`, tokens: `${dir}/tokens.txt`, dataDir: `${dir}/espeak-ng-data` }, numThreads: 2, debug: 0, provider: 'cpu' }, maxNumSentences: 1 });
}
function say(tts, text, sid = 0) {
  const a = tts.generate({ text, sid, speed: 1.0 });
  return new sherpa.LinearResampler(a.sampleRate, 16000).resample(a.samples, true);
}
const silence = (sec) => new Float32Array(Math.round(sec * 16000));
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function pad(x, len) { const o = new Float32Array(len); o.set(x.subarray(0, len)); return o; }
function check(cond, msg) { if (!cond) throw new Error(msg); }

(async () => {
  let t = Date.now();
  await models.installWhisper(modelsDir, 'pianissimo-sv', (p) => { if (p.text) console.log('  ', p.text); });
  console.log(`installation Pianissimo: ${((Date.now() - t) / 1000).toFixed(0)} s`);
  t = Date.now();
  await models.installNemotron(modelsDir, (p) => { if (p.text) console.log('  ', p.text); });
  console.log(`installation Nemotron: ${((Date.now() - t) / 1000).toFixed(0)} s`);
  check(models.whisperFiles(modelsDir, 'pianissimo-sv') && models.nemotronInstalled(modelsDir), 'räknas inte som installerade');
  fs.copyFileSync('silero_vad.onnx', path.join(modelsDir, 'silero_vad.onnx'));

  const sv = makeTts(ttsDir, 'sv_SE-nst-medium.onnx');
  const s1 = say(sv, 'Vi bestämde att leverera ljudet till kampanjen på fredag.');
  const s2 = say(sv, 'Anna tar kontakt med byrån och bokar studion i Stockholm.');
  const s3 = say(sv, 'Budgeten för projektet är fyrtiotusen kronor.');
  const short = concat(s1, silence(0.75), s2, silence(0.75), s3, silence(0.75));
  writeWav('short.wav', short);
  const long = concat(...Array.from({ length: 4 }, () => short));
  writeWav('long.wav', long);

  // 1. Möte utan talare
  const p = new Pipeline({ modelsDir, whisper: 'pianissimo-sv', sherpa });
  t = Date.now();
  const m = await p.meetingPy('short.wav', { diarize: false });
  const text = m.segments.map((s) => s.text).join(' ');
  console.log(`möte, kort (${(short.length / 16000).toFixed(1)} s ljud, ${((Date.now() - t) / 1000).toFixed(1)} s inkl. modelladdning):`, text);
  for (const w of ['fredag', 'Stockholm']) check(text.includes(w), `"${w}" saknas`);
  const l = await p.meetingPy('long.wav', { diarize: false });
  console.log(`möte, långt: ${l.durationSec.toFixed(1)} s ljud på ${l.timing.transcribeSec.toFixed(1)} s (${l.timing.speed.toFixed(1)}× realtid)`);

  // 2. Diktering och livetext
  t = Date.now();
  const d = await p.dictatePy(s1);
  console.log(`diktering (${(s1.length / 16000).toFixed(1)} s ljud) på ${((Date.now() - t) / 1000).toFixed(2)} s:`, d.text);
  const live = new Pipeline({ modelsDir, whisper: 'pianissimo-sv', sherpa });
  await live.liveStart();
  const got = [];
  for (let i = 0; i < short.length; i += 16000) got.push(...(await live.liveFeed(short.subarray(i, i + 16000))));
  got.push(...(await live.liveStop()));
  console.log('livetext:', got.map((s) => `[${s.start.toFixed(1)}] ${s.text}`).join(' | '));
  check(got.length >= 2, 'för få talstycken i livetexten');

  // 3. Två kanaler: jag säger mening 1 i mikrofonen, någon annan säger mening 2 i datorns ljud.
  const n = s1.length + 12000 + s2.length;
  const mic = pad(concat(s1), n);
  const sys = concat(silence((s1.length + 12000) / 16000), s2);
  writeWav('ch.mic.wav', pad(mic, n));
  writeWav('ch.sys.wav', pad(sys, n));
  writeWav('ch.wav', concat(s1, silence(0.75), s2));
  const c = await p.meetingPy('ch.wav', { diarize: true, diarizer: 'nemotron', channels: { mic: 'ch.mic.wav', sys: 'ch.sys.wav' } });
  console.log(`två kanaler (${c.diarizer}):`, c.segments.map((s) => `${s.speaker}: ${s.text}`).join(' | '));
  check(c.segments[0].speaker === 'Jag' && /fredag/.test(c.segments[0].text), 'mikrofonens mening ska vara "Jag"');
  check(c.segments.some((s) => s.speaker !== 'Jag' && /Stockholm/.test(s.text)), 'datorns mening ska ha en annan talare');

  // 4. Två tydligt olika röster i samma kanal (svensk mansröst, engelsk kvinnoröst), A B A.
  //    Två röster ur samma TTS-modell är för lika: varken Nemotron eller den inbyggda skiljer dem.
  const en = makeTts(multiDir, 'en_US-amy-low.onnx');
  const a = say(sv, 'God morgon allihop och tack för att ni kunde vara med i dag. Vi börjar med budgeten för kampanjen.');
  const b = say(en, 'Sure, I have the numbers ready and I can walk you through them right now, it will only take a few minutes.');
  const a2 = say(sv, 'Toppen, dela gärna skärmen när du är redo så går vi igenom siffrorna tillsammans.');
  writeWav('two.wav', concat(a, silence(0.5), b, silence(0.5), a2));
  const describe = (tl) => JSON.stringify(tl.diar.map((x) => [x.start.toFixed(1), x.end.toFixed(1), x.speaker]));
  const std = await p.speakerTimeline({ wavPath: 'two.wav', diarize: true, diarizer: 'standard' });
  console.log(`inbyggd, två röster: ${new Set(std.diar.map((x) => x.speaker)).size} talare`, describe(std));
  t = Date.now();
  const tl = await p.speakerTimeline({ wavPath: 'two.wav', diarize: true, diarizer: 'nemotron' });
  const found = new Set(tl.diar.map((x) => x.speaker)).size;
  console.log(`Nemotron, två röster (${tl.via}, ${((Date.now() - t) / 1000).toFixed(1)} s): ${found} talare`, describe(tl));
  check(tl.via === 'Nemotron 3', 'Nemotron användes inte');
  check(found === 2, `Nemotron hittade ${found} talare, väntade 2`);
  // Första och sista stycket ska vara samma röst, mittstycket en annan.
  const at = (sec) => (tl.diar.find((x) => x.start <= sec && x.end >= sec) || {}).speaker;
  const secA = a.length / 16000 / 2, secB = (a.length + 8000 + b.length / 2) / 16000, secA2 = (a.length + b.length + 16000 + a2.length / 2) / 16000;
  check(at(secA) === at(secA2) && at(secA) !== at(secB), 'Nemotron satte fel talare på styckena');

  pianissimo.stopAll();
})().catch((e) => { console.error(e); pianissimo.stopAll(); process.exit(1); });
