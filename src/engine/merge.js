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

// Döper om talare i ordning efter första förekomst: 0,1,2... -> "Talare 1", "Talare 2"...
function relabelSpeakers(segments, prefix = 'Talare') {
  const map = new Map();
  const out = segments.map((s) => {
    if (!map.has(s.speaker)) map.set(s.speaker, `${prefix} ${map.size + 1}`);
    return { ...s, speaker: map.get(s.speaker) };
  });
  return { segments: out, speakers: [...map.values()] };
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

module.exports = { turnsFromDiarization, assignSpeakers, relabelSpeakers, coalesce, overlap };
