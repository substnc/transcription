const fs = require('fs');
const art = require('./icon-art.js');
const out = process.argv[2];
function icon(size, state, t, fill = '#000000') {
  const sp = (size * 0.98) / (art.COLS - 0.5), r = sp * 0.3, ox = size / 2 - ((art.COLS - 1) / 2) * sp;
  const c = art.DOTS.map(d => `<circle cx="${(ox + d.x * sp).toFixed(1)}" cy="${(size / 2 + d.y * sp).toFixed(1)}" r="${r.toFixed(1)}" opacity="${art.opacity(state, d, t).toFixed(2)}"></circle>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="${fill}" aria-hidden="true">${c}</svg>`;
}
const F = `font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const pill = (inner) => `<div style="align-self: flex-start; height: 36px; padding: 0 18px 0 14px; border-radius: 999px; background: #000000; color: #ffffff; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 10px;">${inner}</div>`;
const listening = pill(`<span style="width: 8px; height: 8px; border-radius: 999px; background: #ffffff;"></span>Lyssnar…`);
const pasted = pill(`<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2l2.2 2.2 4.8-4.8" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>Inklistrat`);
const foot = (n) => `<div style="margin-top: auto; display: flex; justify-content: space-between; font-size: 13px; line-height: 16px; color: #5f5f5f;"><span>${n} / 3</span><span style="color: #000000;">Anthon Bäckström</span></div>`;
function page(title, body) {
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>${title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;background:#ffffff;color:#000000}
a{color:#000000}a:hover{color:#5f5f5f}
</style>
</helmet>
<div style="width: 720px; height: 720px; box-sizing: border-box; background: #ffffff; color: #000000; ${F}; padding: 56px; display: flex; flex-direction: column; gap: 28px;">
${body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":720,"height":720}}'>
class Component extends DCLogic {
renderVals() { return {}; }
}
</script>
</body>
</html>
`;
}
const badge = (k) => k === 'J' ? `<span style="width: 22px; height: 22px; border-radius: 999px; background: #000000; color: #ffffff; font-size: 11px; display: flex; align-items: center; justify-content: center;">J</span>`
  : k === '1' ? `<span style="width: 22px; height: 22px; border-radius: 999px; background: #5f5f5f; color: #ffffff; font-size: 11px; display: flex; align-items: center; justify-content: center;">1</span>`
  : `<span style="width: 20px; height: 20px; border-radius: 999px; border: 1px solid #000000; color: #000000; font-size: 11px; display: flex; align-items: center; justify-content: center;">2</span>`;
const line = (ts, k, name, text) => `<div style="display: grid; grid-template-columns: 44px 22px minmax(0, 1fr); gap: 12px; align-items: start;"><span style="font-size: 13px; line-height: 22px; color: #5f5f5f; font-variant-numeric: tabular-nums;">${ts}</span>${badge(k)}<div><div style="font-size: 13px; line-height: 22px; font-weight: 500;">${name}</div><div style="font-size: 17px; line-height: 24px;">${text}</div></div></div>`;

const s1 = page('Showcase 1: röst blir text', `
<div style="display: flex; flex-direction: column; gap: 8px;">
<div style="font-size: 15px; line-height: 20px; color: #5f5f5f;">Diktering</div>
<div style="font-size: 56px; line-height: 60px; font-weight: 500; letter-spacing: -0.02em;"><div style="color: #000000;">Håll in. Prata.</div><div style="color: #818181;">Släpp.</div></div>
</div>
<div style="display: flex; align-items: center; justify-content: center; flex-grow: 1;">${icon(200, 'live', 0.35)}</div>
<div style="display: flex; flex-direction: column; gap: 14px;">
<div style="min-height: 88px; box-sizing: border-box; padding: 20px 24px; border-radius: 16px; background: #ebecef; font-size: 22px; line-height: 30px;">Hej Karin, jag skickar budgetunderlaget<span style="display: inline-block; width: 2px; height: 26px; margin-left: 2px; vertical-align: -5px; background: #000000;"></span></div>
<div style="display: flex; gap: 12px; align-items: center;">${listening}<span style="font-size: 13px; color: #818181;">→</span>${pasted}</div>
</div>
${foot(1)}`);

const s2 = page('Showcase 2: möte blir text', `
<div style="display: flex; flex-direction: column; gap: 8px;">
<div style="font-size: 15px; line-height: 20px; color: #5f5f5f;">Mötesläge · Kvartalsgenomgång, Almkvist Logistik</div>
<div style="font-size: 56px; line-height: 60px; font-weight: 500; letter-spacing: -0.02em;"><div style="color: #000000;">Möte blir text.</div><div style="color: #818181;">3 talare.</div></div>
</div>
<div style="border-radius: 16px; background: #ebecef; padding: 24px; display: flex; flex-direction: column; gap: 16px;">
${line('00:00', '1', 'Karin', 'Ska vi börja med tredje kvartalet?')}
${line('00:12', 'J', 'Jag', 'Ja. Leveranserna ligger i fas, men höstbudgeten behöver ses över.')}
${line('00:27', '2', 'Omar', 'Då tar jag fram ett nytt förslag till nästa vecka.')}
</div>
<div style="display: flex; flex-direction: column; gap: 6px;"><span style="font-size: 13px; line-height: 16px; color: #5f5f5f;">Sammanfattning</span><div style="font-size: 17px; line-height: 24px;">Höstbudgeten ses över. Omar tar fram ett nytt förslag till nästa vecka.</div></div>
${foot(2)}`);

const s3 = page('Showcase 3: slut', `
<div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center; gap: 36px;">
${icon(120, 'idle', 0)}
<div style="font-size: 96px; line-height: 96px; font-weight: 500; letter-spacing: -0.03em;">Speak.</div>
<div style="font-size: 28px; line-height: 34px; font-weight: 500; letter-spacing: -0.01em;"><div style="color: #818181;">Allt stannar på datorn.</div><div style="color: #818181;">Byggt på Klang Pianissimo.</div></div>
</div>
<div style="margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end;"><span style="font-size: 13px; line-height: 16px; color: #5f5f5f;">3 / 3</span><div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;"><img src="/_blob/1443fbf50ff03443ee4529e5d568d94e" alt="Anthon Bäckströms signatur" style="width: 150px; height: auto; display: block;"><span style="font-size: 13px; line-height: 16px; color: #000000;">Gjord av Anthon Bäckström</span></div></div>`);

fs.mkdirSync(out + '/project', { recursive: true });
fs.writeFileSync(out + '/project/ShowcaseScen1.dc.html', s1);
fs.writeFileSync(out + '/project/ShowcaseScen2.dc.html', s2);
fs.writeFileSync(out + '/project/ShowcaseScen3.dc.html', s3);
