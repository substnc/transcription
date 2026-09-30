// Bygger video.html: tre scener som ritas av render(t), t i sekunder (0..10).
// H=1350 ger stående 4:5 (1080×1350) i stället för fyrkant.
const H = Number(process.env.H || 1080);
const T = H > 1080
  ? { label: [28, 40], hero: [96, 104], meta: [24, 32], small: [24, 40], body: [34, 48], pill: [72, 28, 36], b: 40, tsw: 88, foot: 44, disp: 184, ic1: 380, ic3: 208, sig: 176, gap: 56 }
  : { label: [22, 32], hero: [72, 80], meta: [18, 24], small: [18, 32], body: [26, 36], pill: [56, 22, 28], b: 32, tsw: 64, foot: 36, disp: 144, ic1: 300, ic3: 176, sig: 144, gap: 48 };
const px = ([a, b]) => `font-size:${a}px;line-height:${b}px`;
const fs = require('fs');
const art = require('./icon-art.js');
const sig = fs.readFileSync('signature.png').toString('base64');
const reg = fs.readFileSync('texgyreheros-regular.otf').toString('base64');
const bold = fs.readFileSync('texgyreheros-bold.otf').toString('base64');

const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Speak showcase</title>
<style>
@font-face{font-family:Heros;font-weight:400;src:url(data:font/otf;base64,${reg})}
@font-face{font-family:Heros;font-weight:700;src:url(data:font/otf;base64,${bold})}
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
#stage{width:1080px;height:${H}px;position:relative;overflow:hidden;background:#fff;color:#000;font-family:'Helvetica Neue',Heros,Helvetica,Arial,sans-serif}
.m{font-weight:400;-webkit-text-stroke:.45px currentColor}
.scene{position:absolute;inset:0;padding:80px;display:flex;flex-direction:column;gap:${T.gap}px;will-change:opacity,transform}
.label{${px(T.label)};color:#5f5f5f}
.hero{${px(T.hero)};letter-spacing:-0.02em}
.dim,.hero .dim{color:#818181}
.tile{border-radius:24px;background:#ebecef}
.pill{height:${T.pill[0]}px;padding:0 ${T.pill[2]}px 0 ${T.pill[2] - 4}px;border-radius:999px;background:#000;color:#fff;font-size:${T.pill[1]}px;display:inline-flex;align-items:center;gap:16px;position:absolute;right:0;top:0;white-space:nowrap}
.meta{${px(T.meta)};color:#5f5f5f}
.row{display:grid;grid-template-columns:${T.tsw}px ${T.b}px minmax(0,1fr);gap:16px;align-items:start}
.ts{${px(T.small)};color:#5f5f5f;font-variant-numeric:tabular-nums}
.b{width:${T.b}px;height:${T.b}px;margin-top:${(T.small[1] - T.b) / 2}px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:16px}
.who{${px(T.small)}}
.said{${px(T.body)}}
.caret{display:inline-block;width:3px;height:${T.body[0] + 10}px;margin-left:3px;vertical-align:-${Math.round(T.body[0] * 0.25)}px;background:#000}
</style></head><body><div id="stage">

<div class="scene" id="s1">
 <div style="display:flex;flex-direction:column;gap:12px">
  <div class="label">Diktering</div>
  <div class="hero m"><div id="h1a">Tänk högt.</div><div id="h1b"></div></div>
 </div>
 <div style="flex-grow:1;display:flex;align-items:center;justify-content:center"><svg id="ic1" width="${T.ic1}" height="${T.ic1}" viewBox="0 0 ${T.ic1} ${T.ic1}" fill="#000"></svg></div>
 <div style="display:flex;flex-direction:column;gap:21px">
  <div class="tile" style="min-height:${T.body[1] + 64}px;padding:32px 40px;${px(T.body)}"><span id="typed"></span><span class="caret" id="caret"></span></div>
 </div>
 <div style="margin-top:auto;display:flex;justify-content:space-between;align-items:center"><span class="m" style="font-size:${T.foot}px;line-height:${T.foot}px">Speak.</span><div style="position:relative;width:260px;height:${T.pill[0]}px">
   <div class="pill m" id="p1"><span style="width:12px;height:12px;border-radius:999px;background:#fff"></span>Lyssnar…</div>
   <div class="pill m" id="p2"><svg width="15" height="15" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2l2.2 2.2 4.8-4.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>Inklistrat</div>
  </div></div>
</div>

<div class="scene" id="s2">
 <div style="display:flex;flex-direction:column;gap:12px">
  <div class="label">Mötesläge</div>
  <div class="hero m"><div>Var närvarande.</div><div class="dim">Lokal transkribering.</div></div>
 </div>
 <div class="tile" style="padding:36px;display:flex;flex-direction:column;gap:24px">
  <div class="row" id="r1"><span class="ts">00:00</span><span class="b" style="background:#5f5f5f;color:#fff">1</span><div><div class="who m">Karin</div><div class="said">Ska vi börja med tredje kvartalet?</div></div></div>
  <div class="row" id="r2"><span class="ts">00:12</span><span class="b" style="background:#000;color:#fff">J</span><div><div class="who m">Jag</div><div class="said">Leveranserna ligger i fas, men budgeten behöver ses över.</div></div></div>
  <div class="row" id="r3"><span class="ts">00:27</span><span class="b" style="border:1.5px solid #000">2</span><div><div class="who m">Omar</div><div class="said">Då tar jag fram ett nytt förslag till nästa vecka.</div></div></div>
 </div>
 <div id="sum" style="display:flex;flex-direction:column;gap:8px"><span class="label">Sammanfattning</span><div class="said">Budgeten ses över. Omar tar fram<br>ett nytt förslag till nästa vecka.</div></div>
 <div style="margin-top:auto"><span class="m" style="font-size:${T.foot}px;line-height:${T.foot}px">Speak.</span></div>
</div>

<div class="scene" id="s3">
 <div style="flex-grow:1;display:flex;flex-direction:column;justify-content:center;gap:54px">
  <svg id="ic3" width="${T.ic3}" height="${T.ic3}" viewBox="0 0 ${T.ic3} ${T.ic3}" fill="#000"></svg>
  <div class="m" id="w3" style="font-size:${T.disp}px;line-height:${T.disp}px;letter-spacing:-0.03em">Speak.</div>
  <div style="display:flex;flex-direction:column;gap:16px"><div class="hero m dim" id="l3a">Allt stannar på datorn.</div><div class="label" id="l3b">Byggt på Klang Pianissimo.</div></div>
 </div>
</div>

<div id="sigbox" style="position:absolute;right:80px;bottom:80px;display:flex;flex-direction:column;align-items:flex-end;gap:8px"><img id="sig" src="data:image/png;base64,${sig}" style="width:${T.sig}px;height:auto;display:block"><span class="meta">Made by Anthon Bäckström</span></div>
</div>
<script>
const COLS=${art.COLS}, WAVE=${JSON.stringify(art.WAVE)}, ROW=${art.ROW};
const PERIOD=${JSON.stringify(art.PERIOD)}, DIM=0.14;
const frac=(v)=>v-Math.floor(v), clamp=(v)=>Math.max(0,Math.min(1,v));
${art.opacity.toString()}
${/function windowed[\s\S]*?\n}/.exec(fs.readFileSync('icon-art.js','utf8'))[0]}
const DOTS=${JSON.stringify(art.DOTS)};
function build(svg,size){const sp=(size*0.98)/(COLS-0.5),r=sp*0.3,ox=size/2-((COLS-1)/2)*sp;
 return DOTS.map(d=>{const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('cx',ox+d.x*sp);c.setAttribute('cy',size/2+d.y*sp);c.setAttribute('r',r);svg.appendChild(c);return c;});}
const ic1=build(document.getElementById('ic1'),${T.ic1}), ic3=build(document.getElementById('ic3'),${T.ic3});
const paint=(cs,state,t,mix)=>cs.forEach((c,i)=>{const d=DOTS[i];let o=opacity(state,d,t);if(mix)o=o*(1-mix.k)+opacity(mix.state,d,t)*mix.k;c.setAttribute('opacity',o.toFixed(3));});
const $=(id)=>document.getElementById(id);
const ease=(x)=>{x=clamp(x);return x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;};
const io=(t,a,b)=>ease((t-a)/(b-a));
function show(el,k,dy=18){el.style.opacity=k;el.style.transform='translateY('+((1-k)*dy)+'px)';}
const TEXT='Hej Karin, jag skickar budgetunderlaget innan fredag.';
// Scentider: 1 = 0–3.45, 2 = 3.2–6.75, 3 = 6.5–10. Övergångarna tar 0.45 s.
function render(t){
 const k1=1-io(t,3.0,3.45), k2=io(t,3.2,3.65)*(1-io(t,6.3,6.75)), k3=io(t,6.5,6.95);
 $('s1').style.opacity=k1; $('s1').style.transform='translateY('+(-(1-k1)*24)+'px)';
 $('s2').style.opacity=k2; $('s2').style.transform='translateY('+((t<5?1:-1)*(1-k2)*24)+'px)';
 $('s3').style.opacity=k3; $('s3').style.transform='translateY('+((1-k3)*24)+'px)';
 // Scen 1: ikonen lyssnar, texten klistras in, pillret byter till Inklistrat.
 show($('h1a'),io(t,0,0.4)); show($('h1b'),io(t,0.15,0.55));
 // Speak lyssnar med tomt fält, bearbetar kort och klistrar sedan in hela texten på en gång.
 const toType=io(t,1.55,1.8);
 paint(ic1,'live',t,{state:'type',k:toType});
 const pasted=io(t,1.9,2.02);
 $('typed').textContent=t>=1.9?TEXT:'';
 $('typed').style.opacity=pasted;
 $('caret').style.opacity=Math.floor(t*2.5)%2===0?1:0;
 const sw=io(t,1.9,2.1);
 show($('p1'),io(t,0.1,0.4)*(1-sw),10); show($('p2'),sw,10);
 // Scen 2: raderna kommer en i taget, sedan sammanfattningen.
 const b=3.35; show($('r1'),io(t,b+0.3,b+0.7)); show($('r2'),io(t,b+0.75,b+1.15)); show($('r3'),io(t,b+1.2,b+1.6)); if($('r4'))show($('r4'),io(t,b+1.5,b+1.9)); show($('sum'),io(t,b+1.8,b+2.2));
 // Scen 3: ikonen skriver, namnet och raden tonar in, signaturen ritas fram.
 const c=6.6;
 paint(ic3,'type',t-c,{state:'idle',k:io(t,c+2.3,c+2.8)});
 show($('w3'),io(t,c+0.2,c+0.6)); show($('l3a'),io(t,c+0.55,c+0.95)); show($('l3b'),io(t,c+0.8,c+1.2));
 const s=io(t,c+1.3,c+2.3); $('sig').style.clipPath='inset(0 '+((1-s)*100)+'% 0 0)'; show($('sigbox').lastElementChild,io(t,c+1.9,c+2.3),8);
}
window.render=render; render(0);
</script></body></html>`;
fs.writeFileSync(H === 1080 ? 'video.html' : `video-${H}.html`, html);
