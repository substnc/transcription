// Låtsas-arbetare: talar samma JSON-protokoll som resources/pianissimo/worker.py.
const readline = require('readline');
const fs = require('fs');
process.stdout.write(JSON.stringify({ ready: true, load_sec: 0.01, device: 'cpu' }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  if (!fs.existsSync(req.path)) return process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: 'FileNotFoundError' }) + '\n');
  const out = { id: req.id, ok: true, text: 'Vi ses på fredag. Anna bokar studion.', sec: 0.01 };
  if (req.timestamps) {
    out.segments = [{ start: 0.2, end: 1.4, text: 'Vi ses på fredag.' }, { start: 1.6, end: 2.8, text: 'Anna bokar studion.' }];
    out.words = [{ start: 0.2, end: 0.4, word: 'Vi' }];
  }
  process.stdout.write(JSON.stringify(out) + '\n');
});
