// Låtsas-arbetare: talar samma JSON-protokoll som resources/pianissimo/worker.py.
const readline = require('readline');
const fs = require('fs');
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
send({ ready: true, import_sec: 0.01, device: 'cpu', torch: 'fake' });
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  const cmd = req.cmd || 'transcribe';
  if (cmd === 'load') return send({ id: req.id, ok: true, load_sec: 0.01 });
  if (!fs.existsSync(req.path)) return send({ id: req.id, ok: false, error: 'FileNotFoundError' });
  if (cmd === 'diarize') {
    // Två röster i datorns ljud: 0 till 1,5 s och 2 till 3 s.
    return send({ id: req.id, ok: true, segments: [{ start: 0, end: 1.5, speaker: 0 }, { start: 2, end: 3, speaker: 1 }] });
  }
  const out = { id: req.id, ok: true, text: 'Vi ses på fredag. Anna bokar studion.', sec: 0.01 };
  if (req.timestamps) {
    out.segments = [{ start: 0.2, end: 1.4, text: 'Vi ses på fredag.' }, { start: 1.6, end: 2.8, text: 'Anna bokar studion.' }];
    out.words = [
      { start: 0.2, end: 0.4, word: 'Vi' }, { start: 0.45, end: 0.7, word: 'ses' }, { start: 0.75, end: 0.9, word: 'på' }, { start: 0.95, end: 1.4, word: 'fredag.' },
      { start: 2.1, end: 2.4, word: 'Anna' }, { start: 2.45, end: 2.7, word: 'bokar' }, { start: 2.72, end: 2.8, word: 'studion.' },
    ];
  }
  send(out);
});
