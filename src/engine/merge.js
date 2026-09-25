'use strict';
// Rena funktioner för att kombinera talarseparering med transkriberade segment.

// Slår ihop intilliggande segment från samma talare till talarturer.
function turnsFromDiarization(segments, { maxGap = 0.8 } = {}) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const turns = [];
  for (const s of sorted) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end <= maxGap) {
      last.end = Math.max(last.end, s.end);
    } else {
      turns.push({ start: s.start, end: s.end, speaker: s.speaker });
    }
  }
  return turns;
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

// Ger varje transkriberat segment den talare som överlappar mest, annars närmaste.
function assignSpeakers(asrSegments, diarSegments) {
  return asrSegments.map((seg) => {
    let best = null;
    let bestOv = 0;
    for (const d of diarSegments) {
      const ov = overlap(seg, d);
      if (ov > bestOv) {
        bestOv = ov;
        best = d;
      }
    }
    if (!best && diarSegments.length) {
      const mid = (seg.start + seg.end) / 2;
      best = diarSegments.reduce((p, d) => {
        const dist = Math.min(Math.abs(d.start - mid), Math.abs(d.end - mid));
        return dist < p.dist ? { d, dist } : p;
      }, { d: diarSegments[0], dist: Infinity }).d;
    }
    return { ...seg, speaker: best ? best.speaker : 0 };
  });
}

// Talaren som hörs i mikrofonen (du själv) när mikrofon och datorns ljud spelas in var för sig.
const ME = 'me';
const ME_LABEL = 'Jag';

// Döper om talare i ordning efter första förekomst: 0,1,2... -> "Talare 1", "Talare 2"...
// Mikrofonkanalen ("me") heter alltid "Jag" och räknas inte in i numreringen.
function relabelSpeakers(segments, prefix = 'Talare') {
  const map = new Map();
  let n = 0;
  const out = segments.map((s) => {
    if (!map.has(s.speaker)) map.set(s.speaker, s.speaker === ME ? ME_LABEL : `${prefix} ${++n}`);
    return { ...s, speaker: map.get(s.speaker) };
  });
  return { segments: out, speakers: [...map.values()] };
}

function rms(x, a, b) {
  let s = 0;
  const end = Math.min(b, x.length);
  if (end <= a) return 0;
  for (let i = a; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / (end - a));
}

// Vilken kanal som låter mest, tiondel för tiondel: mikrofonen (du) eller datorns ljud (de andra).
// Mikrofonen är redan dämpad när datorn spelar tal (ekoskyddet), så högtalarljud räknas inte som du.
// Returnerar sammanhängande stycken [{ start, end, source: 'mic' | 'sys' }].
function channelActivity(mic, sys, sampleRate = 16000, { frame = 0.1, threshold = 0.004, maxGap = 0.3 } = {}) {
  const step = Math.round(frame * sampleRate);
  const n = Math.max(mic.length, sys.length);
  const runs = [];
  for (let i = 0; i < n; i += step) {
    const m = rms(mic, i, i + step);
    const y = rms(sys, i, i + step);
    if (Math.max(m, y) < threshold) continue;
    const source = m > y ? 'mic' : 'sys';
    const start = i / sampleRate;
    const end = Math.min(n, i + step) / sampleRate;
    const last = runs[runs.length - 1];
    if (last && last.source === source && start - last.end <= maxGap) last.end = end;
    else runs.push({ start, end, source });
  }
  return runs.filter((r) => r.end - r.start >= 0.2);
}

// Slår ihop kanalstyckena med talarsepareringen av datorns ljud:
// mikrofonstycken blir "me", stycken från datorn får talarna som separeringen hittade där.
function combineChannelDiarization(runs, sysDiar) {
  const out = [];
  for (const r of runs) {
    if (r.source === 'mic') { out.push({ start: r.start, end: r.end, speaker: ME }); continue; }
    const parts = [];
    for (const d of sysDiar) {
      const start = Math.max(r.start, d.start);
      const end = Math.min(r.end, d.end);
      if (end - start > 0.05) parts.push({ start, end, speaker: d.speaker });
    }
    if (parts.length) out.push(...parts);
    else {
      // Separeringen missade stycket: ge det närmaste talare från datorns ljud.
      const mid = (r.start + r.end) / 2;
      const near = sysDiar.reduce((p, d) => { const dist = Math.min(Math.abs(d.start - mid), Math.abs(d.end - mid)); return dist < p.dist ? { d, dist } : p; }, { d: null, dist: Infinity }).d;
      out.push({ start: r.start, end: r.end, speaker: near ? near.speaker : 0 });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Bygger talarturer från ord med tidsstämplar: varje ord får den talare som överlappar mest,
// och nya turer börjar när talaren byts eller när det blir en lång paus.
function segmentsFromWords(words, diar, { maxGap = 1.5, lang } = {}) {
  const withSpk = assignSpeakers(words.filter((w) => w.word && w.start != null && w.end != null).map((w) => ({ start: w.start, end: w.end, text: w.word })), diar);
  const out = [];
  for (const w of withSpk) {
    const last = out[out.length - 1];
    if (last && last.speaker === w.speaker && w.start - last.end <= maxGap) {
      last.end = w.end;
      last.text += ' ' + w.text;
    } else {
      out.push({ start: w.start, end: w.end, text: w.text, speaker: w.speaker, ...(lang ? { lang } : {}) });
    }
  }
  return out;
}

// Slår ihop korta segment från samma talare till läsbara stycken.
function coalesce(segments, { maxGap = 1.0, maxLen = 40 } = {}) {
  const out = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end <= maxGap && s.end - last.start <= maxLen && last.lang === s.lang) {
      last.end = s.end;
      last.text = `${last.text} ${s.text}`.trim();
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

// Talare som bytt nummer mitt i mötet: jämför röstavtrycken (ett medelvärde per talare) och slår ihop
// talare som låter som samma person. voices: { [talare]: { emb: Float32Array (normerad), sec } }.
// Slår ihop paret med högst likhet så länge likheten är över `threshold`, eller så länge det finns fler
// talare än `maxSpeakers`. Den som pratat minst går upp i den andra. Mikrofonen ("me") rörs aldrig.
// Svarar med en tabell { gammal talare: ny talare }.
function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}
function normalize(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}
function mergeSimilarSpeakers(voices, { threshold = 0.6, maxSpeakers = 0 } = {}) {
  const map = {};
  const live = new Map(Object.entries(voices).filter(([k]) => k !== ME).map(([k, v]) => [k, { emb: normalize(v.emb), sec: v.sec }]));
  for (const k of live.keys()) map[k] = k;
  for (;;) {
    let best = null;
    const keys = [...live.keys()];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const sim = cosine(live.get(keys[i]).emb, live.get(keys[j]).emb);
        if (!best || sim > best.sim) best = { a: keys[i], b: keys[j], sim };
      }
    }
    if (!best) break;
    const tooMany = maxSpeakers > 0 && live.size > maxSpeakers;
    if (best.sim < threshold && !tooMany) break;
    const A = live.get(best.a), B = live.get(best.b);
    const [keep, drop] = A.sec >= B.sec ? [best.a, best.b] : [best.b, best.a];
    const K = live.get(keep), D = live.get(drop);
    const w = K.sec + D.sec || 1;
    live.set(keep, { emb: normalize(K.emb.map((x, i) => (x * K.sec + D.emb[i] * D.sec) / w)), sec: K.sec + D.sec });
    live.delete(drop);
    for (const k of Object.keys(map)) if (map[k] === drop) map[k] = keep;
  }
  return map;
}

module.exports = { mergeSimilarSpeakers, turnsFromDiarization, assignSpeakers, relabelSpeakers, coalesce, overlap, channelActivity, combineChannelDiarization, segmentsFromWords, ME, ME_LABEL };
