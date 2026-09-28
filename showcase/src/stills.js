// Stillbilder för Klang i sub.stnc® light. Ett system för alla bilder:
// typskala 18 / 22 / 26 / 72 / 144 px, avstånd i steg om 8 px, marginal 80 px (1:1) och 96 px (16:9).
// Ram: Klang uppe till vänster, Speak. nere till vänster, signatur och Made by nere till höger.
const fs = require('fs');
const art = require('./icon-art.js');
const b64 = (f) => fs.readFileSync(f).toString('base64');
const reg = b64('texgyreheros-regular.otf');
const SIG = `data:image/png;base64,${b64('signature.png')}`;

function icon(size, state = 'idle', t = 0, fill = '#000', rf = 0.3) {
  const sp = (size * 0.98) / (art.COLS - 0.5), r = sp * rf, ox = size / 2 - ((art.COLS - 1) / 2) * sp;
  const op = (d) => state === 'hero' ? (d.row ? art.opacity('type', d, t) : 1) : art.opacity(state, d, t);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="${fill}" style="display:block">` + art.DOTS.map(d =>
    `<circle cx="${(ox + d.x * sp).toFixed(1)}" cy="${(size / 2 + d.y * sp).toFixed(1)}" r="${r.toFixed(1)}" opacity="${op(d).toFixed(2)}"/>`).join('') + '</svg>';
}
function meter(cols, half, sp, r, seed = 3) {
  let x = seed; const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const w = (cols - 1) * sp + 2 * r, h = half * 2 * sp + 2 * r; let s = '';
  for (let i = 0; i < cols; i++) {
    const env = Math.sin(Math.PI * i / (cols - 1)) ** 0.7, lvl = Math.round(env * (0.3 + 0.6 * rnd()) * half);
    for (let j = -half; j <= half; j++) s += `<circle cx="${(r + i * sp).toFixed(1)}" cy="${(r + (j + half) * sp).toFixed(1)}" r="${r}" opacity="${Math.abs(j) <= lvl ? 1 : 0.14}"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">${s}</svg>`;
}
const css = `
@font-face{font-family:Heros;font-weight:400;src:url(data:font/otf;base64,${reg})}
*{box-sizing:border-box}html,body{margin:0;background:#fff}
#stage{position:relative;overflow:hidden;background:#fff;color:#000;font-family:'Helvetica Neue',Heros,Helvetica,Arial,sans-serif}
.m{-webkit-text-stroke:.45px currentColor}
.meta{font-size:18px;line-height:24px;color:#5f5f5f}
.label{font-size:22px;line-height:32px;color:#5f5f5f}
.body{font-size:26px;line-height:36px}
.h1{font-size:72px;line-height:80px;letter-spacing:-0.02em}
.dim{color:#818181}
.tile{border-radius:24px;background:#ebecef}
.pill{height:56px;padding:0 28px 0 24px;border-radius:999px;background:#000;color:#fff;font-size:22px;display:inline-flex;align-items:center;gap:16px;white-space:nowrap}
.row{display:grid;grid-template-columns:64px 32px minmax(0,1fr);gap:16px;align-items:start}
.ts{font-size:18px;line-height:32px;color:#5f5f5f;font-variant-numeric:tabular-nums}
.b{width:32px;height:32px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:16px}
.who{font-size:18px;line-height:32px}
`;
const B = { J: 'background:#000;color:#fff', 1: 'background:#5f5f5f;color:#fff', 2: 'border:1.5px solid #000' };
const line = (ts, k, who, said) => `<div class="row"><span class="ts">${ts}</span><span class="b" style="${B[k]}">${k}</span><div><div class="who m">${who}</div><div class="body">${said}</div></div></div>`;
const pillOk = `<div class="pill m"><svg width="16" height="16" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2l2.2 2.2 4.8-4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Inklistrat</div>`;
const pillListen = `<div class="pill m"><span style="width:12px;height:12px;border-radius:999px;background:#fff"></span>Lyssnar…</div>`;
const made = `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px"><img src="${SIG}" alt="Anthon Bäckströms signatur" style="width:144px;height:auto;display:block"><span class="meta">Made by Anthon Bäckström</span></div>`;
// Ramen och en innehållsyta mellan rubrikraden och sidfoten.
function frame(w, h, M, body, { speak = true } = {}) {
  return `<div class="label" style="position:absolute;left:${M}px;top:${M}px">Byggt med Klang Pianissimo</div>
<div style="position:absolute;left:${M}px;right:${M}px;top:${M + 96}px;bottom:${M + 136}px">${body}</div>
<div style="position:absolute;left:${M}px;right:${M}px;bottom:${M}px;display:flex;justify-content:space-between;align-items:flex-end">${speak ? '<span class="m" style="font-size:36px;line-height:36px">Speak.</span>' : '<span></span>'}${made}</div>`;
}
const page = (w, h, inner) => `<!doctype html><html lang="sv"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="stage" style="width:${w}px;height:${h}px">${inner}</div></body></html>`;

const imgs = {};

// 1. Huvudbild: ikonen på en grå yta, namnet och en rad om vad appen gör.
imgs['01-hero-16x9'] = [1920, 1080, frame(1920, 1080, 96, `
<div style="height:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:96px">
 <div class="tile" style="display:flex;align-items:center;justify-content:center">${icon(480, 'hero', 0.62)}</div>
 <div style="display:flex;flex-direction:column;justify-content:center;gap:32px">
  <div class="m" style="font-size:144px;line-height:144px;letter-spacing:-0.03em">Speak.</div>
  <div class="h1 m dim">Diktering och möten.<br>Allt på datorn.</div>
 </div>
</div>`, { speak: false })];

// 2. Ikonen som ritning: var rösten är och var texten börjar.
{
  const S = 544, sp = (S * 0.98) / (art.COLS - 0.5), cx = 1080 / 2 - 80, oy = 336; // koordinater inne i innehållsytan
  const ox = cx - ((art.COLS - 1) / 2) * sp, xw = ox + 4 * sp, xr = ox + 10 * sp, base = 640;
  imgs['02-ikon-ritning-1x1'] = [1080, 1080, frame(1080, 1080, 80, `
<div style="position:absolute;left:${cx - S / 2}px;top:${oy - S / 2}px">${icon(S, 'hero', 0.62)}</div>
<div style="position:absolute;background:#000;left:${xw}px;top:${oy + 7 * sp}px;width:1.5px;height:${base - (oy + 7 * sp)}px"></div>
<div style="position:absolute;background:#000;left:${xr}px;top:${oy + sp}px;width:1.5px;height:${base - (oy + sp)}px"></div>
<div style="position:absolute;background:#000;left:${xw}px;top:${base}px;width:${xr - xw + 1.5}px;height:1.5px"></div>
<div class="label" style="position:absolute;left:${xw}px;top:${base + 16}px">Röst</div>
<div class="label" style="position:absolute;left:${xr}px;top:${base + 16}px;transform:translateX(-100%)">Text</div>`)];
}

// 3. Diktering: rubrik, texten som klistras in, statuspillren.
imgs['03-diktering-1x1'] = [1080, 1080, frame(1080, 1080, 80, `
<div style="height:100%;display:flex;flex-direction:column;gap:48px">
 <div style="display:flex;flex-direction:column;gap:8px"><span class="label">Diktering</span><div class="h1 m">Tänk högt.</div></div>
 <div style="flex-grow:1;display:flex;align-items:center;justify-content:center">${icon(240, 'live', 0.3)}</div>
 <div class="tile body" style="padding:32px 40px">Hej Karin, jag skickar budgetunderlaget innan fredag.</div>
 <div style="display:flex;align-items:center;gap:16px">${pillListen}<span class="label">→</span>${pillOk}</div>
</div>`)];

// 4. Möte: rubrik och sammanfattning till vänster, samtalet till höger.
imgs['04-mote-16x9'] = [1920, 1080, frame(1920, 1080, 96, `
<div style="height:100%;display:grid;grid-template-columns:640px minmax(0,1fr);gap:96px;align-items:center">
 <div style="display:flex;flex-direction:column;gap:48px">
  <div style="display:flex;flex-direction:column;gap:8px"><span class="label">Mötesläge</span><div class="h1 m">Var närvarande.<br><span class="dim">Lokal transkribering.</span></div></div>
  <div style="display:flex;flex-direction:column;gap:8px"><span class="label">Sammanfattning</span><div class="body">Budgeten ses över. Omar tar fram<br>ett nytt förslag till nästa vecka.</div></div>
 </div>
 <div class="tile" style="padding:40px;display:flex;flex-direction:column;gap:24px">
  ${line('00:00', 1, 'Karin', 'Ska vi börja med tredje kvartalet?')}
  ${line('00:12', 'J', 'Jag', 'Leveranserna ligger i fas, men budgeten behöver ses över.')}
  ${line('00:27', 2, 'Omar', 'Då tar jag fram ett nytt förslag till nästa vecka.')}
  ${line('00:41', 1, 'Karin', 'Bra. Vi stämmer av på måndag.')}
 </div>
</div>`)];

// 5. Flödet: ljud, Pianissimo, text. Tre steg, samma avstånd.
imgs['05-flode-1x1'] = [1080, 1080, frame(1080, 1080, 80, `
<div style="height:100%;display:flex;flex-direction:column;gap:48px">
 <div class="h1 m">Från röst till text.<br><span class="dim">Allt på datorn.</span></div>
 <div style="display:flex;flex-direction:column;gap:32px">
  <div style="display:flex;flex-direction:column;gap:16px"><span class="label">1 · Ljud</span>${meter(58, 3, 16, 4.4, 11)}</div>
  <div style="display:flex;flex-direction:column;gap:16px"><span class="label">2 · Taligenkänning</span><div class="pill m" style="align-self:flex-start">${icon(40, 'type', 0.5, '#fff', 0.42)}Klang Pianissimo</div></div>
  <div style="display:flex;flex-direction:column;gap:16px"><span class="label">3 · Text</span><div class="tile body" style="padding:24px 32px">Hej Karin, jag skickar budgetunderlaget innan fredag.</div></div>
 </div>
</div>`)];

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
