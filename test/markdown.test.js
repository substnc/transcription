const test = require('node:test');
const assert = require('node:assert');
const { buildMeetingNote, formatTimestamp, safeFilename, transcriptAsText } = require('../src/engine/markdown');

test('tidsstämplar', () => {
  assert.strictEqual(formatTimestamp(5), '00:05');
  assert.strictEqual(formatTimestamp(83.7), '01:23');
  assert.strictEqual(formatTimestamp(3725), '01:02:05');
});

test('filnamn rensas', () => {
  assert.strictEqual(safeFilename('Kund: "Delicato" / kickoff #2'), 'Kund Delicato kickoff 2');
});

test('obsidian-anteckning med frontmatter', () => {
  const note = buildMeetingNote({
    title: 'Kickoff',
    date: new Date(2026, 8, 17, 14, 5),
    durationSec: 1500,
    speakers: ['Anna', 'Talare 2'],
    languages: ['sv', 'en'],
    segments: [{ start: 0, end: 3, speaker: 'Anna', text: 'Hej allihopa.' }, { start: 65, end: 70, speaker: 'Talare 2', text: 'Hello.' }],
    summary: 'Vi pratade om kampanjen.',
    decisions: ['Leverans på fredag'],
    todos: [{ text: 'Skicka offert', owner: 'Anna' }, 'Boka studio'],
    consent: true,
    model: 'whisper-small',
    audioPath: '/tmp/x.wav',
  });
  assert.strictEqual(note.filename, '2026-09-17 1405 Kickoff.md');
  const c = note.content;
  assert.ok(c.startsWith('---\ntitle: "Kickoff"\ndate: 2026-09-17\n'));
  assert.ok(c.includes('type: meeting'));
  assert.ok(c.includes('languages:\n  - "sv"\n  - "en"'));
  assert.ok(c.includes('consent_confirmed: true'));
  assert.ok(c.includes('processing: local'));
  assert.ok(c.includes('- [ ] Skicka offert (Anna)'));
  assert.ok(c.includes('- [ ] Boka studio'));
  assert.ok(c.includes('- Leverans på fredag'));
  assert.ok(c.includes('**[00:00] Anna:** Hej allihopa.'));
  assert.ok(c.includes('**[01:05] Talare 2:** Hello.'));
  assert.ok(c.endsWith('\n'));
});

test('tom anteckning får standardtitel', () => {
  const note = buildMeetingNote({ date: new Date(2026, 0, 2, 9, 0), segments: [] });
  assert.strictEqual(note.title, 'Möte 2026-01-02 09:00');
  assert.ok(note.content.includes('_Inga beslut noterade._'));
});

test('transkript som text', () => {
  assert.strictEqual(transcriptAsText([{ start: 0, speaker: 'A', text: 'Hej' }]), '[00:00] A: Hej');
});
