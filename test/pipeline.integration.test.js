// Körs bara om DIKTERA_TEST_MODELS pekar på en mapp med whisper-tiny, silero_vad och talarmodellerna.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const dir = process.env.DIKTERA_TEST_MODELS;
const wav = process.env.DIKTERA_TEST_WAV;
const skip = !dir || !wav || !fs.existsSync(path.join(dir, 'silero_vad.onnx'));

test('hela kedjan: talarseparering + whisper + sammanfattning + markdown', { skip }, async () => {
  const { Pipeline } = require('../src/engine/pipeline');
  const { buildMeetingNote } = require('../src/engine/markdown');
  const { heuristicSummary } = require('../src/engine/summarize');
  const p = new Pipeline({ modelsDir: dir, whisper: 'tiny', numThreads: 2 });
  const progress = [];
  const r = await p.meeting(wav, { policy: { language: 'auto', allowed: ['sv', 'en'], primary: 'sv' }, onProgress: (x) => progress.push(x) });
  assert.ok(r.segments.length >= 3, 'segment');
  assert.ok(r.speakers.length === 2, `två talare, fick ${r.speakers.length}`);
  assert.ok(r.segments.every((s) => ['sv', 'en'].includes(s.lang)), 'bara sv/en');
  assert.ok(r.segments.some((s) => /final mix|friday/i.test(s.text)), 'engelska hittad');
  assert.ok(progress.some((x) => x.phase === 'diarize') && progress.some((x) => x.phase === 'transcribe'));
  const note = buildMeetingNote({ title: 'Test', date: new Date(), durationSec: r.durationSec, speakers: r.speakers, segments: r.segments, languages: r.languages, ...heuristicSummary(r.segments), consent: true });
  assert.ok(note.content.includes('## Transkript'));
  // Diktering
  const { readWav } = require('../src/engine/audio');
  const d = p.dictate(readWav(wav).samples.subarray(16000 * 9, 16000 * 16), { policy: { language: 'en' } });
  assert.ok(/deliver/i.test(d.text), d.text);
});

test('server-processen svarar via RPC', { skip }, async () => {
  const { fork } = require('child_process');
  const child = fork(path.join(__dirname, '..', 'src', 'engine', 'server.js'), [], { serialization: 'advanced' });
  const pending = new Map();
  let n = 0;
  const call = (method, params) => new Promise((res, rej) => { const id = ++n; pending.set(id, { res, rej }); child.send({ id, method, params }); });
  await new Promise((res) => child.on('message', function h(m) { if (m.ready) { child.off('message', h); res(); } }));
  child.on('message', (m) => { const p = pending.get(m.id); if (!p || m.progress) return; pending.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.result); });
  const st = await call('init', { modelsDir: dir, whisper: 'tiny', numThreads: 2 });
  assert.ok(st.whisper.tiny.installed);
  const { readWav } = require('../src/engine/audio');
  const d = await call('dictate', { samples: readWav(wav).samples.subarray(16000 * 9, 16000 * 16), policy: { language: 'en' }, useLlm: false, voiceCommands: true });
  assert.ok(/deliver/i.test(d.text), d.text);
  assert.strictEqual(d.cleanedBy, 'rules');
  const m = await call('meeting', { wavPath: wav, policy: { language: 'auto' }, diarize: true });
  assert.strictEqual(m.speakers.length, 2);
  const s = await call('summarize', { segments: m.segments, useLlm: false });
  assert.strictEqual(s.by, 'rules');
  await assert.rejects(call('nope', {}));
  child.kill();
});
