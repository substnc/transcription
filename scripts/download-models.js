#!/usr/bin/env node
// Laddar ner modeller från terminalen (samma sak som knapparna i Inställningar).
// Användning: npm run models -- [whisper-namn] [--all-aux] [--dir <mapp>]
const path = require('path');
const os = require('os');
const models = require('../src/engine/models');

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const modelsDir = dirIdx >= 0 ? args[dirIdx + 1] : path.join(os.homedir(), 'Library', 'Application Support', 'sub.stnc® - Speak', 'models');
const whisper = args.find((a) => models.WHISPER_MODELS[a]) || 'turbo-metal';

function bar(name) {
  let last = -1;
  return (p) => {
    if (p.phase === 'extract') return process.stdout.write(`\r${name}: packar upp...          \n`);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    if (pct !== last) { last = pct; process.stdout.write(`\r${name}: ${pct}% (${(p.done / 1e6).toFixed(0)} MB)   `); }
  };
}

(async () => {
  console.log('Modellmapp:', modelsDir);
  const st = models.status(modelsDir);
  for (const key of Object.keys(models.AUX_MODELS)) {
    if (st.aux[key].installed) { console.log(`${key}: finns redan`); continue; }
    await models.installAux(modelsDir, key, bar(key));
    console.log(`\n${key}: klar`);
  }
  if (st.whisper[whisper].installed) console.log(`whisper-${whisper}: finns redan`);
  else if (st.whisper[whisper].manual) console.log(`${whisper} importeras manuellt (se scripts/kb-whisper/README.md)`);
  else {
    await models.installWhisper(modelsDir, whisper, bar(`whisper-${whisper}`));
    console.log(`\nwhisper-${whisper}: klar`);
  }
  console.log('Klart. Starta appen och välj modellen i Inställningar.');
})().catch((e) => { console.error('\nFel:', e.message); process.exit(1); });
