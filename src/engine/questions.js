'use strict';
// Frågor efter mötet: det Speak är osäker på och som du lätt kan svara på. Körs efter transkriberingen.
//  - Namn ur samtalet: "Som du sa, Per" och sedan svarar en talare. Tydligt (flera gånger, samma talare)
//    sätts namnet direkt. Osäkert blir en fråga.
//  - Samma person: två talare vars röster liknar varandra men inte nog för att slås ihop automatiskt.
//  - Ord: där korrläsningen bytte ett ord mot ett namn eller en fackterm.
// Inget lämnar datorn. Ingen språkmodell behövs.

const ME = 'Jag';
// Vanliga ord som står först i en mening med komma efter och inte är namn.
const STOP = new Set(('okej ok ja nej men så och alltså precis bra hej tack jaha aha nä nja visst absolut exakt jo '
  + 'du ni vi jag han hon de den det där här nu då sen sedan kanske typ liksom asså ah oj hm mm eh öh '
  + 'yes no well so and but okay right sure thanks hello hi hey oh sorry').split(' '));

const NAME = '[A-ZÅÄÖ][a-zåäöéü]{1,15}';

function knownNames(about) {
  const out = new Set();
  for (const m of String(about || '').matchAll(new RegExp(`(?:^|[^\\p{L}])(${NAME})`, 'gu'))) {
    if (!STOP.has(m[1].toLowerCase())) out.add(m[1]);
  }
  return out;
}

// Namn som någon tilltalas med i en replik: "Per, vad tycker du?", "som du sa, Per, är…", "…eller hur, Per?".
function addressedNames(text) {
  const t = String(text || '');
  const found = [];
  const re = new RegExp(`(^|[.!?]\\s+|,\\s*|\\s)(${NAME})(?=\\s*([,?!.]|$))`, 'gu');
  for (const m of t.matchAll(re)) {
    const name = m[2];
    if (STOP.has(name.toLowerCase())) continue;
    const atStart = m[1] === '' || /[.!?]\s+$/.test(m[1]);
    // Först i en mening måste namnet följas av komma ("Per, …"), annars är det bara ett vanligt första ord.
    if (atStart && m[3] !== ',') continue;
    found.push(name);
  }
  return found;
}

// "Jag heter Per", "det är Per här", "Per här".
function selfNames(text) {
  const t = String(text || '');
  const out = [];
  for (const re of [new RegExp(`jag heter (${NAME})`, 'gu'), new RegExp(`det är (${NAME}) här`, 'gu'), new RegExp(`my name is (${NAME})`, 'gu'), new RegExp(`this is (${NAME})`, 'gu')]) {
    for (const m of t.matchAll(re)) if (!STOP.has(m[1].toLowerCase())) out.push(m[1]);
  }
  return out;
}

// Röster för namn per talare. Svarar { votes: { talare: { namn: { n, evidence: [[i, j]] } } } }.
function nameVotes(segments, about) {
  const known = knownNames(about);
  const votes = {};
  const add = (speaker, name, ev, w = 1) => {
    if (!speaker || speaker === ME) return;
    votes[speaker] = votes[speaker] || {};
    const v = (votes[speaker][name] = votes[speaker][name] || { n: 0, evidence: [] });
    v.n += w;
    if (v.evidence.length < 3) v.evidence.push(ev);
  };
  const mentions = {};
  segments.forEach((s, i) => {
    for (const name of selfNames(s.text)) add(s.speaker, name, [i, i], 2);
    for (const name of addressedNames(s.text)) {
      mentions[name] = (mentions[name] || 0) + 1;
      // Den som svarar: nästa replik från någon annan, inom tre repliker och 20 sekunder.
      for (let j = i + 1; j < Math.min(segments.length, i + 4); j++) {
        const r = segments[j];
        if (r.start - (s.end || s.start) > 20) break;
        if (r.speaker !== s.speaker) { add(r.speaker, name, [i, j]); break; }
      }
    }
  });
  // Namn som inte finns i "Vad handlar mötet om?" måste nämnas minst två gånger för att räknas.
  for (const sp of Object.keys(votes)) {
    for (const name of Object.keys(votes[sp])) {
      if (!known.has(name) && (mentions[name] || 0) < 2 && votes[sp][name].n < 2) delete votes[sp][name];
    }
  }
  return votes;
}

function decideNames(segments, speakers, about) {
  const votes = nameVotes(segments, about);
  const totals = {};
  for (const sp of Object.keys(votes)) for (const [name, v] of Object.entries(votes[sp])) totals[name] = (totals[name] || 0) + v.n;
  const auto = {};
  const unsure = [];
  const taken = new Set();
  const ranked = Object.entries(votes)
    .map(([sp, byName]) => {
      const [name, v] = Object.entries(byName).sort((a, b) => b[1].n - a[1].n)[0] || [];
      return name ? { speaker: sp, name, n: v.n, share: v.n / totals[name], evidence: v.evidence } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.n - a.n);
  for (const r of ranked) {
    if (!speakers.includes(r.speaker) || taken.has(r.name)) continue;
    if (r.n >= 2 && r.share >= 0.75) { auto[r.speaker] = { name: r.name, evidence: r.evidence }; taken.add(r.name); }
    else unsure.push(r);
  }
  return { auto, unsure: unsure.filter((r) => !taken.has(r.name)) };
}

// Ord: jämför repliken före och efter korrläsningen och plocka ut bytta ord.
function wordDiff(a, b) {
  const x = String(a).split(/\s+/).filter(Boolean);
  const y = String(b).split(/\s+/).filter(Boolean);
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = norm(x[i]) === norm(y[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0, from = [], to = [];
  const flush = () => { if (from.length && to.length) out.push({ from: from.join(' '), to: to.join(' ') }); from = []; to = []; };
  while (i < n || j < m) {
    if (i < n && j < m && norm(x[i]) === norm(y[j])) { flush(); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) to.push(y[j++]);
    else from.push(x[i++]);
  }
  flush();
  return out;
}

function wordQuestions(corrections, max = 3) {
  const out = [];
  for (const c of corrections || []) {
    for (const d of wordDiff(c.before, c.after)) {
      // Namn och facktermer (stor bokstav, siffror) är värda en fråga. Små stavningsändringar är det inte.
      if (!/[A-ZÅÄÖ0-9]/.test(d.to) || d.to.replace(/[^\p{L}]/gu, '').length < 3) continue;
      out.push({ type: 'word', index: c.index, from: d.from.replace(/[,.!?]+$/, ''), to: d.to.replace(/[,.!?]+$/, '') });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// Alla frågor för ett möte. similar: [{ a, b, sim }] (talare som låter lika). corrections: [{ index, before, after }].
function buildQuestions({ segments = [], speakers = [], similar = [], corrections = [], about = '' } = {}) {
  const { auto, unsure } = decideNames(segments, speakers, about);
  const questions = [];
  for (const p of [...similar].sort((x, y) => y.sim - x.sim).slice(0, 2)) {
    if (speakers.includes(p.a) && speakers.includes(p.b) && p.a !== ME && p.b !== ME) questions.push({ type: 'same', a: p.a, b: p.b, sim: p.sim });
  }
  for (const u of unsure.slice(0, 2)) questions.push({ type: 'name', speaker: u.speaker, name: u.name, evidence: u.evidence });
  questions.push(...wordQuestions(corrections));
  return { autoNames: Object.fromEntries(Object.entries(auto).map(([sp, v]) => [sp, v.name])), autoEvidence: auto, questions };
}

module.exports = { buildQuestions, addressedNames, selfNames, nameVotes, decideNames, wordDiff, wordQuestions, knownNames };
