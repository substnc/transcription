// Sömlösa loopar i sub.stnc® light. Skriver loops.html; render(name, t) ritar bilden vid tiden t.
const fs = require('fs');
const art = require('./icon-art.js');
const b64 = (f) => fs.readFileSync(f).toString('base64');
const FPS = 25;
// Loopernas längd är hela perioder av ikonens animation och mätarens mönster, så att slutet möter början.
const LOOPS = { lyssnar: 2.4, skriver: 3.2, ljud: 4.0, mote: 6.4 };
const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><style>
@font-face{font-family:Heros;font-weight:400;src:url(data:font/otf;base64,${b64('texgyreheros-regular.otf')})}
*{box-sizing:border-box}html,body{margin:0;background:#fff}
.stage{width:1080px;height:1080px;position:relative;overflow:hidden;background:#fff;color:#000;font-family:'Helvetica Neue',Heros,Helvetica,Arial,sans-serif;display:none}
.m{-webkit-text-stroke:.45px currentColor}
.label{font-size:22px;line-height:30px;color:#5f5f5f}.dim{color:#818181}
.tile{border-radius:24px;background:#ebecef}
.pill{height:54px;padding:0 27px 0 21px;border-radius:999px;background:#000;color:#fff;font-size:20px;display:inline-flex;align-items:center;gap:15px;white-space:nowrap}
.foot{position:absolute;left:84px;right:84px;bottom:84px;display:flex;justify-content:space-between;align-items:baseline}
.row{display:grid;grid-template-columns:66px 33px minmax(0,1fr);gap:18px;align-items:start}
.ts{font-size:20px;line-height:33px;color:#5f5f5f;font-variant-numeric:tabular-nums}
.b{width:33px;height:33px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:16px}
.who{font-size:20px;line-height:33px}.said{font-size:26px;line-height:36px}
</style></head><body>
${(() => {
  const foot = `<div class="label" style="position:absolute;left:84px;top:84px">Byggt med Klang Pianissimo</div><div style="position:absolute;left:84px;right:84px;bottom:84px;display:flex;justify-content:space-between;align-items:flex-end"><span class="m" style="font-size:36px;line-height:36px">Speak.</span><div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px"><img src="data:image/png;base64,${b64('signature.png')}" alt="Anthon Bäckströms signatur" style="width:150px;height:auto;display:block"><span class="label" style="font-size:18px;line-height:22px">Made by Anthon Bäckström</span></div></div>`;
  const dot = `<span style="width:12px;height:12px;border-radius:999px;background:#fff"></span>`;
  const ring = `<span style="width:12px;height:12px;border-radius:999px;border:2px solid #fff"></span>`;
  const B = { J: 'background:#000;color:#fff', 1: 'background:#5f5f5f;color:#fff', 2: 'border:1.5px solid #000' };
  const line = (id, ts, k, who, said) => `<div class="row" id="${id}"><span class="ts">${ts}</span><span class="b" style="${B[k]}">${k}</span><div><div class="who m">${who}</div><div class="said">${said}</div></div></div>`;
  return `
<div class="stage" id="lyssnar"><div style="position:absolute;inset:0 0 120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px"><svg data-icon="560" width="560" height="560"></svg><div class="pill m">${dot}Lyssnar…</div></div>${foot}</div>
<div class="stage" id="skriver"><div style="position:absolute;inset:0 0 120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px"><svg data-icon="560" width="560" height="560"></svg><div class="pill m">${ring}Skriver…</div></div>${foot}</div>
<div class="stage" id="ljud"><div class="tile" style="position:absolute;left:84px;right:84px;top:250px;height:500px;display:flex;align-items:center;justify-content:center"><svg data-meter="44,6,19,5.6"></svg></div>${foot}</div>
<div class="stage" id="mote"><div style="position:absolute;inset:150px 84px 230px;display:flex;flex-direction:column;gap:22px">
 <div style="display:flex;align-items:center;justify-content:space-between"><div class="m" style="font-size:64px;line-height:68px;letter-spacing:-0.02em">Möte blir text.</div><div class="pill m">${ring}Transkriberar…</div></div>
 <svg data-meter="61,3,15,4.2"></svg>
 <div class="tile" style="padding:28px 36px;display:flex;flex-direction:column;gap:16px">
  ${line('m1', '00:00', 1, 'Karin', 'Ska vi börja med tredje kvartalet?')}
  ${line('m2', '00:12', 'J', 'Jag', 'Ja. Leveranserna ligger i fas, men budgeten behöver ses över.')}
  ${line('m3', '00:27', 2, 'Omar', 'Då tar jag fram ett nytt förslag till nästa vecka.')}
  ${line('m4', '00:41', 1, 'Karin', 'Bra. Vi stämmer av på måndag.')}
 </div>
 <div id="m5" style="display:flex;flex-direction:column;gap:9px"><span class="label">Sammanfattning</span><div class="said">Budgeten ses över. Omar tar fram ett nytt förslag till nästa vecka.</div></div>
</div>${foot}</div>`;
})()}
<script>
const COLS=${art.COLS}, PERIOD=${JSON.stringify(art.PERIOD)}, DIM=0.14, FPS=${FPS}, LOOPS=${JSON.stringify(LOOPS)};
const frac=(v)=>v-Math.floor(v), clamp=(v)=>Math.max(0,Math.min(1,v));
${art.opacity.toString()}
${/function windowed[\s\S]*?\n}/.exec(fs.readFileSync('icon-art.js', 'utf8'))[0]}
const DOTS=${JSON.stringify(art.DOTS)};
const NS='http://www.w3.org/2000/svg';
const mk=(svg,cx,cy,r)=>{const c=document.createElementNS(NS,'circle');c.setAttribute('cx',cx);c.setAttribute('cy',cy);c.setAttribute('r',r);svg.appendChild(c);return c;};
document.querySelectorAll('svg[data-icon]').forEach(s=>{const size=+s.dataset.icon,sp=(size*0.98)/(COLS-0.5),r=sp*0.3,ox=size/2-((COLS-1)/2)*sp;s.setAttribute('viewBox','0 0 '+size+' '+size);s.dots=DOTS.map(d=>mk(s,ox+d.x*sp,size/2+d.y*sp,r));});
// Ljudnivåer: ett mönster som upprepas, en kolumn per bildruta, så att loopen går jämnt ihop.
function levels(n,seed){let x=seed;const rnd=()=>((x=(x*9301+49297)%233280)/233280);const raw=[];
 for(let i=0;i<n;i++){const ph=2*Math.PI*i/n;const talk=0.5+0.5*Math.sin(ph*3+1)*Math.sin(ph*5);raw.push(Math.max(0,talk)*(0.25+0.6*rnd())*0.95);}
 return raw.map((v,i)=>0.25*raw[(i-1+n)%n]+0.5*v+0.25*raw[(i+1)%n]);}
document.querySelectorAll('svg[data-meter]').forEach(s=>{const [cols,half,sp,r]=s.dataset.meter.split(',').map(Number);
 const w=(cols-1)*sp+2*r,h=half*2*sp+2*r;s.setAttribute('width',w);s.setAttribute('height',h);s.setAttribute('viewBox','0 0 '+w+' '+h);
 s.grid=[];for(let i=0;i<cols;i++){const col=[];for(let j=-half;j<=half;j++)col.push({c:mk(s,r+i*sp,r+(j+half)*sp,r),l:Math.abs(j)});s.grid.push(col);}s.half=half;});
const $=(id)=>document.getElementById(id);
const ease=(x)=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;};
function icon(stage,state,t){stage.querySelector('svg[data-icon]').dots.forEach((c,i)=>c.setAttribute('opacity',opacity(state,DOTS[i],t).toFixed(3)));}
function meter(s,t,loop,seed){const n=Math.round(loop*FPS);if(!s.lv)s.lv=levels(n,seed);const f=Math.round(t*FPS);
 s.grid.forEach((col,i)=>{const v=s.lv[(i+f)%n];const amp=Math.round(Math.min(1,v)*s.half);col.forEach(d=>d.c.setAttribute('opacity',(d.l<=amp&&(v>0.03||d.l===0))?1:0.14));});}
function show(el,k){el.style.opacity=k;el.style.transform='translateY('+((1-k)*16)+'px)';}
function render(name,t){document.querySelectorAll('.stage').forEach(s=>s.style.display=s.id===name?'block':'none');const st=$(name);
 if(name==='lyssnar')icon(st,'live',t);
 if(name==='skriver')icon(st,'type',t);
 if(name==='ljud')meter(st.querySelector('svg[data-meter]'),t,LOOPS.ljud,5);
 if(name==='mote'){t=(t+5.0)%LOOPS.mote;meter(st.querySelector('svg[data-meter]'),t,LOOPS.mote,9);
  const out=1-ease((t-5.6)/0.6);
  ['m1','m2','m3','m4','m5'].forEach((id,i)=>show($(id),Math.min(ease((t-0.3-i*1.05)/0.4),out)));}
}
window.render=render;window.LOOPS=LOOPS;window.FPS=FPS;
</script></body></html>`;
fs.writeFileSync('loops.html', html);

if (process.argv[2]) (async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: Number(process.env.SCALE || 1) });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + __dirname + '/loops.html'); await p.evaluate(() => document.fonts.ready);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const [name, len] of Object.entries(LOOPS)) {
    const times = only ? (only.includes(name) ? [0.1, len * 0.5] : []) : Array.from({ length: Math.round(len * FPS) }, (_, i) => i / FPS);
    const dir = `${process.argv[2]}/${name}`; fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < times.length; i++) {
      await p.evaluate(([n, t]) => window.render(n, t), [name, times[i]]);
      await (await p.$('#' + name)).screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.png` });
    }
  }
  if (errs.length) console.log(errs);
  await br.close();
})();
