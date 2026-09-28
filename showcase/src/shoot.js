const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [mode, ...ts] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1080 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + __dirname + '/video.html'); await p.evaluate(() => document.fonts.ready);
  const el = await p.$('#stage');
  const list = mode === 'all' ? Array.from({ length: 300 }, (_, i) => i / 30) : ts.map(Number);
  require('fs').mkdirSync(mode === 'all' ? 'frames' : 'stills', { recursive: true });
  for (let i = 0; i < list.length; i++) {
    await p.evaluate(t => window.render(t), list[i]);
    await el.screenshot({ path: mode === 'all' ? `frames/f${String(i).padStart(4, '0')}.png` : `stills/t${list[i]}.png` });
  }
  if (errs.length) console.log(errs);
  await b.close();
})();
