const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { channelActivity, combineChannelDiarization, segmentsFromWords, relabelSpeakers } = require('../src/engine/merge');
const pianissimo = require('../src/engine/pianissimo');
const { Pipeline } = require('../src/engine/pipeline');
const audio = require('../src/engine/audio');

const SR = 16000;
function tone(sec, amp) {
  const x = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR);
  return x;
}
function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('kanalerna avgör vem som pratar: mikrofonen är jag, datorns ljud är de andra', () => {
  // 0–1 s: jag pratar. 1–2 s: tyst. 2–3 s: någon i datorn (mikrofonen är dämpad, bara svagt eko).
  const mic = concat(tone(1, 0.3), tone(1, 0), tone(1, 0.01));
  const sys = concat(tone(1, 0), tone(1, 0), tone(1, 0.3));
  const runs = channelActivity(mic, sys, SR);
  assert.deepStrictEqual(runs.map((r) => [r.source, +r.start.toFixed(1), +r.end.toFixed(1)]), [['mic', 0, 1], ['sys', 2, 3]]);
});

test('datorns talare läggs in där datorn hörs, mikrofonen blir "me"', () => {
  const runs = [{ start: 0, end: 1, source: 'mic' }, { start: 2, end: 4, source: 'sys' }, { start: 5, end: 6, source: 'sys' }];
  const sysDiar = [{ start: 1.8, end: 3, speaker: 0 }, { start: 3, end: 4.2, speaker: 1 }];
  const d = combineChannelDiarization(runs, sysDiar);
  assert.deepStrictEqual(d.map((x) => [x.speaker, x.start, x.end]), [['me', 0, 1], [0, 2, 3], [1, 3, 4], [1, 5, 6]]);
});

test('talare per ord: byte mitt i en mening hamnar rätt, och "me" heter Jag', () => {
  const words = [{ start: 0, end: 0.4, word: 'Hej' }, { start: 0.5, end: 0.9, word: 'allihop.' }, { start: 1.2, end: 1.5, word: 'Tack,' }, { start: 1.6, end: 2.0, word: 'hej.' }];
  const diar = [{ start: 0, end: 1.0, speaker: 'me' }, { start: 1.1, end: 2.1, speaker: 3 }];
  const segs = segmentsFromWords(words, diar, { lang: 'sv' });
  assert.deepStrictEqual(segs.map((s) => [s.speaker, s.text]), [['me', 'Hej allihop.'], [3, 'Tack, hej.']]);
  const l = relabelSpeakers(segs);
  assert.deepStrictEqual(l.speakers, ['Jag', 'Talare 1']);
});

function nemoDir() {
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speak-spk-'));
  const dir = path.join(modelsDir, 'pianissimo-sv');
  fs.mkdirSync(path.join(dir, 'venv', 'bin'), { recursive: true });
  const py = path.join(dir, 'venv', 'bin', 'python');
  fs.writeFileSync(py, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-pianissimo.js')}"\n`);
  fs.chmodSync(py, 0o755);
  fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ components: ['asr', 'diar'] }));
  return modelsDir;
}

test.after(() => pianissimo.stopAll());

test('möte med två kanaler och Nemotron: Jag från mikrofonen, de andra från datorns ljud', async () => {
  const modelsDir = nemoDir();
  // Jag pratar 0–1,5 s i mikrofonen; en annan person 2–3 s i datorns ljud.
  const mic = concat(tone(1.5, 0.3), tone(1.5, 0));
  const sys = concat(tone(2, 0), tone(1, 0.3));
  const wav = path.join(modelsDir, 'm.wav');
  audio.writeWav(wav, concat(tone(3, 0.1)));
  audio.writeWav(path.join(modelsDir, 'm.mic.wav'), mic);
  audio.writeWav(path.join(modelsDir, 'm.sys.wav'), sys);
  const p = new Pipeline({ modelsDir, whisper: 'pianissimo-sv' });
  const r = await p.meetingPy(wav, { diarize: true, diarizer: 'nemotron', channels: { mic: path.join(modelsDir, 'm.mic.wav'), sys: path.join(modelsDir, 'm.sys.wav') } });
  assert.strictEqual(r.diarizer, 'Nemotron 3 + kanaler');
  assert.deepStrictEqual(r.segments.map((s) => [s.speaker, s.text]), [['Jag', 'Vi ses på fredag.'], ['Talare 1', 'Anna bokar studion.']]);
});

test('utan kanaler används Nemotron på hela filen, och "standard" hoppar över den', async () => {
  const modelsDir = nemoDir();
  const wav = path.join(modelsDir, 'n.wav');
  audio.writeWav(wav, tone(3, 0.1));
  const p = new Pipeline({ modelsDir, whisper: 'pianissimo-sv' });
  const t = await p.speakerTimeline({ wavPath: wav, diarize: true, diarizer: 'nemotron' });
  assert.strictEqual(t.via, 'Nemotron 3');
  assert.strictEqual(t.diar.length, 2);
  const off = await p.speakerTimeline({ wavPath: wav, diarize: false });
  assert.deepStrictEqual(off, { diar: [], via: 'av' });
});
