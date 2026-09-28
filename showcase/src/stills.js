// Stillbilder för Klang i sub.stnc® light. Skriver stills/<namn>.html och tar 4K-bilder med Playwright.
const fs = require('fs');
const art = require('./icon-art.js');
const b64 = (f) => fs.readFileSync(f).toString('base64');
const reg = b64('texgyreheros-regular.otf'), bold = b64('texgyreheros-bold.otf');

function icon(size, state = 'idle', t = 0, fill = '#000', rf = 0.3) {
  const sp = (size * 0.98) / (art.COLS - 0.5), r = sp * rf, ox = size / 2 - ((art.COLS - 1) / 2) * sp;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="${fill}">` + art.DOTS.map(d =>
    `<circle cx="${(ox + d.x * sp).toFixed(1)}" cy="${(size / 2 + d.y * sp).toFixed(1)}" r="${r.toFixed(1)}" opacity="${(state === 'hero' ? (d.row ? art.opacity('type', d, t) : 1) : art.opacity(state, d, t)).toFixed(2)}"/>`).join('') + '</svg>';
}
// Nivåmätare av prickar som i mötesläget: kolumner, höjd efter en påhittad ljudnivå.
function meter(cols, half, sp, r, seed = 3, fill = '#000') {
  let x = seed; const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const w = (cols - 1) * sp + 2 * r, h = half * 2 * sp + 2 * r; let s = '';
  for (let i = 0; i < cols; i++) {
    const env = Math.sin(Math.PI * i / (cols - 1)) ** 0.7;
    const lvl = Math.round(env * (0.35 + 0.65 * rnd()) * half);
    for (let j = -half; j <= half; j++)
      s += `<circle cx="${(r + i * sp).toFixed(1)}" cy="${(r + (j + half) * sp).toFixed(1)}" r="${r}" opacity="${Math.abs(j) <= lvl ? 1 : 0.14}"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="${fill}">${s}</svg>`;
}
const css = `
@font-face{font-family:Heros;font-weight:400;src:url(data:font/otf;base64,${reg})}
@font-face{font-family:Heros;font-weight:700;src:url(data:font/otf;base64,${bold})}
*{box-sizing:border-box}html,body{margin:0;background:#fff}
#stage{position:relative;overflow:hidden;background:#fff;color:#000;font-family:'Helvetica Neue',Heros,Helvetica,Arial,sans-serif}
.m{-webkit-text-stroke:.45px currentColor}
.label{font-size:22px;line-height:30px;color:#5f5f5f}
.dim{color:#818181}
.tile{border-radius:24px;background:#ebecef}
.win{background:#fff;border-radius:24px;position:relative}
.lights{position:absolute;left:24px;top:24px;display:flex;gap:12px}.lights span{width:18px;height:18px;border-radius:999px;background:#ebecef}
.pill{height:54px;padding:0 27px 0 21px;border-radius:999px;background:#000;color:#fff;font-size:20px;display:inline-flex;align-items:center;gap:15px;white-space:nowrap}
.row{display:grid;grid-template-columns:66px 33px minmax(0,1fr);gap:18px;align-items:start}
.ts{font-size:20px;line-height:33px;color:#5f5f5f;font-variant-numeric:tabular-nums}
.b{width:33px;height:33px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:16px}
.who{font-size:20px;line-height:33px}.said{font-size:26px;line-height:36px}
.tag{font-size:18px;line-height:22px;color:#5f5f5f;display:flex;align-items:center;gap:10px}
.tag::before{content:"";width:9px;height:9px;border-radius:999px;background:#000}
.hair{position:absolute;background:#000}
.grid{position:absolute;inset:0;background-image:radial-gradient(circle,#c9ccd3 1.6px,transparent 1.8px);background-size:36px 36px}
`;
const page = (w, h, body) => `<!doctype html><html lang="sv"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="stage" style="width:${w}px;height:${h}px">${body}</div></body></html>`;
const pill = `<div class="pill m"><svg width="15" height="15" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2l2.2 2.2 4.8-4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Inklistrat</div>`;
const listen = `<div class="pill m"><span style="width:12px;height:12px;border-radius:999px;background:#fff"></span>Lyssnar…</div>`;
const B = { J: 'background:#000;color:#fff', 1: 'background:#5f5f5f;color:#fff', 2: 'border:1.5px solid #000' };
const line = (ts, k, who, said) => `<div class="row"><span class="ts">${ts}</span><span class="b" style="${B[k]}">${k}</span><div><div class="who m">${who}</div><div class="said">${said}</div></div></div>`;

const imgs = {};

// 1. Liggande hero: ikonen stor på en grå yta, rubrik till höger.
imgs['01-hero-16x9'] = [1920, 1080, `
<div style="position:absolute;inset:0;padding:96px;display:grid;grid-template-columns:900px minmax(0,1fr);gap:96px;align-items:stretch">
 <div class="tile" style="position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden"><div class="grid" style="opacity:.55"></div><div style="position:relative">${icon(620, 'hero', 0.62)}</div></div>
 <div style="display:flex;flex-direction:column;justify-content:space-between">
  <div class="label">Byggt med Klang Pianissimo</div>
  <div style="display:flex;flex-direction:column;gap:40px">
   <div class="m" style="font-size:140px;line-height:140px;letter-spacing:-0.03em">Speak.</div>
   <div class="m dim" style="font-size:56px;line-height:62px;letter-spacing:-0.02em">Röst blir text.<br>Direkt på datorn.</div>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:14px 28px"><span class="tag">Diktering</span><span class="tag">Möten med talare</span><span class="tag">Svenska och engelska</span><span class="tag">Allt stannar på datorn</span></div>
 </div>
</div>`];

// 2. Fyrkant: ikonen i närbild som teknisk ritning, röst till vänster, text till höger.
{
  const S = 720, sp = (S * 0.98) / (art.COLS - 0.5), ox = 1080 / 2 - ((art.COLS - 1) / 2) * sp, oy = 430;
  const xw = ox + 4 * sp, xr = ox + 10 * sp; // mitt i vågen, mitt i raden
  imgs['02-ikon-ritning-1x1'] = [1080, 1080, `
<div class="grid" style="opacity:.5"></div>
<div style="position:absolute;left:${1080 / 2 - S / 2}px;top:${oy - S / 2}px">${icon(S, 'hero', 0.62)}</div>
<div class="hair" style="left:${xw}px;top:${oy + 7 * sp}px;width:1.5px;height:${880 - (oy + 7 * sp)}px"></div>
<div class="hair" style="left:${xr}px;top:${oy + 1 * sp}px;width:1.5px;height:${880 - (oy + 1 * sp)}px"></div>
<div class="hair" style="left:${xw}px;top:880px;width:${xr - xw}px;height:1.5px"></div>
<div style="position:absolute;left:${xw - 100}px;top:896px;width:200px;text-align:center" class="label">Röst</div>
<div style="position:absolute;left:${xr - 100}px;top:896px;width:200px;text-align:center" class="label">Text</div>
<div style="position:absolute;left:84px;right:84px;bottom:84px;display:flex;justify-content:space-between;align-items:baseline"><span class="m" style="font-size:36px">Speak.</span><span class="label">Byggt med Klang Pianissimo</span></div>`];
}

// 3. Fyrkant: dikteringen i ett appfönster på grå yta.
imgs['03-diktering-1x1'] = [1080, 1080, `
<div style="position:absolute;inset:0;background:#ebecef"></div>
<div style="position:absolute;left:84px;top:84px" class="label">Diktering</div>
<div class="win" style="position:absolute;left:84px;right:84px;top:160px;height:720px;padding:96px 60px 60px;display:flex;flex-direction:column;justify-content:center;gap:44px">
 <div class="lights"><span></span><span></span><span></span></div>
 <div style="display:flex;align-items:center;gap:30px">${icon(120, 'live', 0.3)}<div class="m" style="font-size:52px;line-height:56px;letter-spacing:-0.02em">Håll in. Prata.<br><span class="dim">Släpp.</span></div></div>
 <div class="tile" style="padding:30px 36px;font-size:30px;line-height:42px">Hej Karin, jag skickar budgetunderlaget innan fredag.</div>
 <div style="display:flex;align-items:center;gap:18px">${listen}<span class="label">→</span>${pill}</div>
</div>
<div style="position:absolute;left:84px;right:84px;bottom:84px;display:flex;justify-content:space-between;align-items:baseline"><span class="m" style="font-size:36px">Speak.</span><span class="label">Byggt med Klang Pianissimo</span></div>`];

// 4. Liggande: mötet som text, med nivåmätare och sammanfattning.
imgs['04-mote-16x9'] = [1920, 1080, `
<div style="position:absolute;inset:0;background:#ebecef"></div>
<div class="win" style="position:absolute;left:96px;right:96px;top:96px;bottom:96px;padding:110px 72px 64px;display:grid;grid-template-columns:560px minmax(0,1fr);gap:72px">
 <div class="lights"><span></span><span></span><span></span></div>
 <div style="display:flex;flex-direction:column;gap:36px">
  <div class="label">Mötesläge · Kvartalsgenomgång, Almkvist Logistik</div>
  <div class="m" style="font-size:72px;line-height:76px;letter-spacing:-0.02em">Möte blir text.<br><span class="dim">3 talare.</span></div>
  <div style="display:flex;flex-direction:column;gap:9px"><span class="label">Sammanfattning</span><div class="said">Budgeten ses över. Omar tar fram ett nytt förslag till nästa vecka.</div></div>
  <div style="margin-top:auto">${meter(44, 3, 12, 3.4, 7)}</div>
 </div>
 <div class="tile" style="padding:40px;display:flex;flex-direction:column;gap:28px">
  ${line('00:00', 1, 'Karin', 'Ska vi börja med tredje kvartalet?')}
  ${line('00:12', 'J', 'Jag', 'Ja. Leveranserna ligger i fas, men budgeten behöver ses över.')}
  ${line('00:27', 2, 'Omar', 'Då tar jag fram ett nytt förslag till nästa vecka.')}
  ${line('00:41', 1, 'Karin', 'Bra. Vi stämmer av på måndag.')}
  ${line('00:48', 'J', 'Jag', 'Jag skickar underlaget till er båda i dag.')}
  ${line('00:56', 2, 'Omar', 'Perfekt, då har jag det inför förslaget.')}
 </div>
</div>`];

// 5. Fyrkant: flödet i tre steg, allt inom datorn.
imgs['05-flode-1x1'] = [1080, 1080, `
<div style="position:absolute;inset:0;padding:84px;display:flex;flex-direction:column;gap:42px">
 <div class="m" style="font-size:72px;line-height:78px;letter-spacing:-0.02em">Röst in. Text ut.<br><span class="dim">Inget lämnar datorn.</span></div>
 <div class="tile" style="flex-grow:1;padding:48px;display:flex;flex-direction:column;gap:26px;position:relative;border:0">
  <div class="label" style="position:absolute;right:48px;top:40px">På datorn</div>
  <div style="display:flex;flex-direction:column;gap:14px"><span class="label">1 · Ljud</span>${meter(46, 3, 16, 4.4, 11)}</div>
  <div style="width:1.5px;height:40px;background:#000;margin-left:4px"></div>
  <div style="display:flex;flex-direction:column;gap:14px"><span class="label">2 · Taligenkänning</span><div style="height:64px;border-radius:999px;background:#000;color:#fff;display:flex;align-items:center;gap:18px;padding:0 30px;font-size:24px" class="m">${icon(40, 'type', 0.5, '#fff', 0.42)}Klang Pianissimo</div></div>
  <div style="width:1.5px;height:40px;background:#000;margin-left:4px"></div>
  <div style="display:flex;flex-direction:column;gap:14px"><span class="label">3 · Text</span><div style="background:#fff;border-radius:16px;padding:22px 28px;font-size:26px;line-height:36px">Hej Karin, jag skickar budgetunderlaget innan fredag.</div></div>
 </div>
 <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="m" style="font-size:36px">Speak.</span><span class="label">Gjord av Anthon Bäckström</span></div>
</div>`];

fs.mkdirSync('stills-src', { recursive: true });
for (const [n, [w, h, body]] of Object.entries(imgs)) fs.writeFileSync(`stills-src/${n}.html`, page(w, h, body));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const br = await chromium.launch(); const out = process.argv[2] || 'bilder';
  fs.mkdirSync(out, { recursive: true });
  for (const [n, [w, h]] of Object.entries(imgs)) {
    const p = await br.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(process.env.SCALE || 2) });
    await p.goto('file://' + __dirname + `/stills-src/${n}.html`); await p.evaluate(() => document.fonts.ready);
    await (await p.$('#stage')).screenshot({ path: `${out}/speak-${n}.png` }); await p.close();
  }
  await br.close();
})();
