const $ = (id) => document.getElementById(id);
const api = window.diktera;

const state = { result: null, speakerNames: {}, customFolder: null, settings: null, audioPath: null, consent: false, startedAt: null };
let timerHandle = null;

// Mötessidans läge rapporteras till huvudsidan och menyn: spelar in, transkriberar, klart eller inget.
let current = 'idle';
function report(extra = {}) {
  const title = $('title').value.trim();
  const st = current === 'recording' ? 'recording' : current === 'processing' ? 'processing' : (current === 'result' || current === 'questions') && !state.saved ? 'done' : 'idle';
  api.meeting.report({ state: st, title, startedAt: state.startedAt, ...extra });
}

function show(section) {
  for (const id of ['idle', 'recording', 'processing', 'questions', 'result']) $(id).classList.toggle('hidden', id !== section);
  current = section;
  report();
}

// Tillbaka till huvudsidan. Mötet ligger kvar här, inspelningen fortsätter.
$('btnBack').onclick = () => api.open.home();

function fmt(sec) {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${p(h)}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

function speakerCount() {
  const n = parseInt($('speakerCount').value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function meetingOpts() {
  return { speakerCount: speakerCount(), language: $('language').value || undefined, title: $('title').value.trim(), about: $('about').value.trim() };
}

function fail(msg) {
  clearInterval(timerHandle);
  if (current === 'recording' || current === 'processing') show('idle');
  $('errorText').textContent = msg;
  $('errorBox').classList.remove('hidden');
  show(state.result ? 'result' : 'idle');
}
$('errorClose').onclick = () => $('errorBox').classList.add('hidden');

// Talare som en rund bricka: "Jag" (mikrofonen) får J på svart, övriga ett nummer och en egen stil.
function badge(speaker) {
  const b = document.createElement('span');
  const others = state.result.speakers.filter((s) => s !== 'Jag');
  const i = others.indexOf(speaker);
  b.className = `badge s${speaker === 'Jag' ? 0 : (i % 4) + 1}`;
  b.textContent = speaker === 'Jag' ? 'J' : String(i + 1);
  return b;
}

// ---- Nivåmätare: prickar som rullar, samma formspråk som ikonen ----
const meter = window.SpeakIcon.meter($('meter'));
const pushLevel = (level) => meter.push(level);
$('workIcon').appendChild(window.SpeakIcon.svg(56, '#000000', 'type'));

// ---- Samtycke ----
$('btnRecord').onclick = () => {
  $('consentCheck').checked = false;
  $('consentOk').disabled = true;
  $('consent').classList.remove('hidden');
};
$('consentCheck').onchange = (e) => ($('consentOk').disabled = !e.target.checked);
$('consentCancel').onclick = () => $('consent').classList.add('hidden');
$('consentOk').onclick = async () => {
  $('consent').classList.add('hidden');
  state.consent = true;
  try {
    state.audioPath = await api.meeting.start({ sourceMode: $('sourceMode').value });
    state.startedAt = Date.now();
    meter.reset();
    $('liveText').innerHTML = '';
    $('liveStatus').textContent = '';
    $('sources').textContent = 'Mikrofon';
    show('recording');
    timerHandle = setInterval(() => ($('timer').textContent = fmt((Date.now() - state.startedAt) / 1000)), 500);
  } catch (e) {
    fail('Kunde inte starta inspelning: ' + e.message);
  }
};

// ---- Livetext ----
api.meeting.onLiveStatus((s) => ($('liveStatus').textContent = s.text || ''));
api.meeting.onLive((segs) => {
  const box = $('liveText');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  for (const s of segs) {
    const p = document.createElement('p');
    const t = document.createElement('span'); t.className = 't'; t.textContent = fmt(s.start);
    p.append(t, s.text);
    box.appendChild(p);
  }
  if (atBottom) box.scrollTop = box.scrollHeight;
});

// ---- Inspelning ----
api.meeting.onLevel(({ level }) => pushLevel(level));
api.meeting.onError((msg) => fail('Mikrofonfel: ' + msg));
api.meeting.onInfo((info) => {
  $('sources').textContent = info.systemAudio ? (info.mic ? 'Mikrofon och datorns ljud' : 'Bara datorns ljud') : info.mic ? (info.wantedSystem ? 'Bara mikrofon (datorns ljud gick inte att ta upp, kolla Skärminspelning i Inställningar)' : 'Bara mikrofon') : 'Ingen ljudkälla';
});

$('btnStop').onclick = async () => {
  clearInterval(timerHandle);
  show('processing');
  setProgress({ phase: 'load', text: 'Laddar modeller…' });
  try {
    showResult(await api.meeting.stop(meetingOpts()));
  } catch (e) {
    fail('Transkriberingen misslyckades: ' + e.message);
  }
};
$('btnCancel').onclick = async () => {
  clearInterval(timerHandle);
  await api.meeting.cancel();
  state.audioPath = null;
  show('idle');
};

async function upload() {
  state.consent = false;
  show('processing');
  setProgress({ phase: 'convert', text: 'Väljer fil…' });
  try {
    const r = await api.meeting.upload(meetingOpts());
    if (!r) return show('idle');
    state.audioPath = r.wavPath;
    state.startedAt = Date.now();
    showResult(r);
  } catch (e) {
    fail('Kunde inte läsa filen: ' + e.message);
  }
}
$('btnUpload').onclick = upload;

// ---- Progress ----
const STEP_ORDER = ['load', 'convert', 'diarize', 'transcribe', 'cleanup', 'summarize'];
function setProgress(p) {
  const idx = STEP_ORDER.indexOf(p.phase);
  document.querySelectorAll('.steps .chip').forEach((c) => {
    const i = STEP_ORDER.indexOf(c.dataset.step);
    c.classList.toggle('active', i === idx);
    c.classList.toggle('done', i < idx);
  });
  const texts = { load: 'Laddar modeller…', convert: 'Konverterar ljudet…', diarize: 'Hittar talare…', transcribe: 'Transkriberar', summarize: 'Sammanfattar med lokal språkmodell…' };
  let text = p.text || texts[p.phase] || '';
  let frac = 0;
  if (p.phase === 'transcribe' && p.unit === 'percent') {
    frac = Math.min(1, p.done / 100);
    text = `Transkriberar, ${Math.floor(p.done)} %`;
  } else if (p.phase === 'transcribe' && p.total) {
    frac = Math.min(1, p.done / p.total);
    text = `Transkriberar talartur ${Math.min(p.total, Math.floor(p.done) + 1)} av ${p.total}`;
  } else if (p.phase === 'diarize') frac = p.done ? 1 : 0;
  else if (p.phase === 'cleanup' && p.total) {
    frac = Math.min(1, p.done / p.total);
    text = p.text ? `${p.text} ${Math.round(frac * 100)} %` : `Korrläser transkriptet med den lokala språkmodellen, rad ${Math.min(p.total, p.done + 1)} av ${p.total}`;
  } else if (p.phase === 'summarize' && p.total) {
    frac = Math.min(1, p.done / p.total);
    text = `Sammanfattar långt möte, del ${Math.min(p.total, p.done + 1)} av ${p.total}`;
  } else if (p.phase === 'summarize') frac = 1;
  $('progressBar').style.width = `${Math.round(frac * 100)}%`;
  $('progressText').textContent = text;
  if (current === 'processing') report({ frac, text });
}
api.meeting.onProgress(setProgress);

// ---- Resultat ----
function showResult(r) {
  state.saved = false;
  state.result = r;
  // Namn som Speak är säker på (tilltal och svar i samtalet) sätts direkt.
  state.speakerNames = Object.fromEntries(r.speakers.map((s) => [s, (r.autoNames && r.autoNames[s]) || s]));
  // Frågorna visas som kort innan texten, bara när fler än två talare är med.
  state.questions = r.speakers.length > 2 ? (r.questions || []).slice() : [];
  state.qIndex = 0;
  state.qChanged = false;
  state.picked.clear();
  state.anchor = null;
  state.openClips.clear();
  $('resultTitle').textContent = $('title').value.trim() || 'Möte';
  const d = new Date(state.startedAt || Date.now());
  $('meta').textContent = `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(r.durationSec)} · ${r.speakers.length} talare · ${(r.languages || []).join(', ') || '–'} · ${r.model}${r.timing ? ` · ${r.engine === 'whisper.cpp' ? 'Metal' : 'CPU'} ${r.timing.totalSec.toFixed(0)} s (${r.timing.speed.toFixed(1)}× realtid)` : ''}${r.diarizer && r.diarizer !== 'av' ? ` · talare: ${r.diarizer}` : ''}`;
  renderSpeakers();
  renderSegments();
  fillSummary(r.summary);
  renderInboxes();
  $('saveStatus').textContent = '';
  if (state.questions.length) return showQuestions();
  show('result');
  fitAll();
  updateQuestionsLeft();
}
window.addEventListener('resize', () => $('segments').querySelectorAll('textarea').forEach(fitText));

// Två talare är samma person: allt som from sa blir to:s.
function mergeSpeaker(from, to) {
  state.result.segments.forEach((seg) => { if (seg.speaker === from) seg.speaker = to; });
  state.result.speakers = state.result.speakers.filter((o) => o !== from);
  delete state.speakerNames[from];
}

function renderSpeakers() {
  const el = $('speakers');
  el.innerHTML = '';
  for (const s of state.result.speakers) {
    const wrap = document.createElement('div');
    wrap.className = 'sp';
    const dot = badge(s);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = state.speakerNames[s];
    input.placeholder = s;
    input.oninput = () => { state.speakerNames[s] = input.value.trim() || s; renderSegments(); };
    // Samma namn som en annan talare: det är samma person. Slå ihop dem (till exempel Talare 7 → Anna).
    input.onchange = () => {
      const name = input.value.trim().toLowerCase();
      const other = state.result.speakers.find((o) => o !== s && (state.speakerNames[o] || o).toLowerCase() === name);
      if (!name || !other) return;
      mergeSpeaker(s, other);
      renderSpeakers();
      renderSegments();
    };
    wrap.append(dot, input);
    el.appendChild(wrap);
  }
  const span = document.createElement('span');
  span.className = 'status';
  span.style.marginLeft = 'auto';
  span.textContent = `00:00 – ${fmt(state.result.durationSec)}`;
  el.appendChild(span);
}

// Raderna. Rader som språkmodellen tror är video (aside) och rader du markerat visas i en vit ruta med
// knappar. Markering: klicka i rundeln, shift-klick markerar allt mellan två rader.
const CHECK_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
const CLIP_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="1" y="2.5" width="12" height="9" rx="2" stroke="#5f5f5f" stroke-width="1.3"></rect><path d="M6 5.3v3.4L8.8 7z" fill="#5f5f5f"></path></svg>';
state.picked = new Set();
state.anchor = null;
state.openClips = new Set();

function segRow(seg, i) {
  const row = document.createElement('div');
  row.className = 'seg';
  row.dataset.i = String(i);
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = `pick${state.picked.has(i) ? ' on' : ''}`;
  pick.setAttribute('aria-label', state.picked.has(i) ? 'Avmarkera raden' : 'Markera raden');
  pick.innerHTML = CHECK_SVG;
  pick.onclick = (e) => togglePick(i, e.shiftKey);
  const t = document.createElement('div'); t.className = 't'; t.textContent = fmt(seg.start);
  const lane = badge(seg.speaker);
  lane.title = `${fmt(seg.start)} – ${fmt(seg.end)}`;
  const body = document.createElement('div'); body.className = 'body';
  const sp = document.createElement('div'); sp.className = 'sp';
  const name = document.createElement('span'); name.textContent = state.speakerNames[seg.speaker] || seg.speaker;
  sp.append(name);
  if (seg.lang) { const l = document.createElement('span'); l.className = 'lang'; l.textContent = `· ${seg.lang}`; sp.appendChild(l); }
  const ta = document.createElement('textarea'); ta.value = seg.text; ta.rows = 1;
  ta.oninput = () => { state.result.segments[i].text = ta.value; fitText(ta); };
  body.append(sp, ta);
  row.append(pick, t, lane, body);
  return row;
}

// Textrutan blir precis så hög som texten, utan rullningslist.
function fitText(ta) {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}
// Alla textrutor på en gång: först nollställ, sedan läs, sedan sätt, så att sidan bara räknas om en gång.
function fitAll() {
  const tas = [...$('segments').querySelectorAll('textarea')];
  tas.forEach((ta) => (ta.style.height = 'auto'));
  const h = tas.map((ta) => ta.scrollHeight);
  tas.forEach((ta, k) => (ta.style.height = `${h[k]}px`));
}

function togglePick(i, shift) {
  if (shift && state.anchor !== null) {
    const [a, b] = state.anchor < i ? [state.anchor, i] : [i, state.anchor];
    for (let k = a; k <= b; k++) state.picked.add(k);
  } else if (state.picked.has(i)) {
    state.picked.delete(i);
  } else {
    state.picked.add(i);
  }
  state.anchor = i;
  renderSegments();
}

function groupBox(kind, head) {
  const g = document.createElement('div');
  g.className = `group ${kind}`;
  const h = document.createElement('div'); h.className = 'head';
  h.innerHTML = head;
  g.appendChild(h);
  return g;
}

function pillButtons(items) {
  const d = document.createElement('div'); d.className = 'btns';
  for (const [text, primary, fn] of items) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    if (primary) b.className = 'primary';
    b.onclick = fn;
    d.appendChild(b);
  }
  return d;
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Avmarkerar bara de här raderna. Markeringar i andra rutor ligger kvar.
function unpick(indices) {
  indices.forEach((k) => state.picked.delete(k));
  state.anchor = null;
}

// Tar bort rader (index) och gör om sammanfattningen. Talare som inte har någon rad kvar försvinner.
// Andra markerade rader förblir markerade (deras index flyttas med).
function removeRows(indices) {
  const drop = new Set(indices);
  const kept = [];
  const moved = new Set();
  state.result.segments.forEach((seg, k) => {
    if (drop.has(k)) return;
    if (state.picked.has(k)) moved.add(kept.length);
    kept.push(seg);
  });
  state.result.segments = kept;
  const left = new Set(kept.map((s) => s.speaker));
  state.result.speakers = state.result.speakers.filter((s) => left.has(s));
  state.picked = moved;
  state.anchor = null;
  renderSpeakers();
  renderSegments();
  resummarize();
}

function renderSegments() {
  const el = $('segments');
  el.innerHTML = '';
  const segs = state.result.segments;
  el.classList.toggle('picking', state.picked.size > 0);
  let i = 0;
  while (i < segs.length) {
    // Markerade rader i följd: en vit ruta med Ta bort och Avbryt.
    if (state.picked.has(i) && !segs[i].aside) {
      let j = i;
      while (j + 1 < segs.length && state.picked.has(j + 1) && !segs[j + 1].aside) j++;
      const n = j - i + 1;
      const g = groupBox('picked', `<span><b>${n} ${n === 1 ? 'rad' : 'rader'} markerade</b> · ${fmt(segs[i].start)} – ${fmt(segs[j].end)}</span>`);
      for (let k = i; k <= j; k++) g.appendChild(segRow(segs[k], k));
      const rows = Array.from({ length: n }, (_, k) => i + k);
      g.appendChild(pillButtons([
        [`Ta bort ${n} ${n === 1 ? 'rad' : 'rader'}`, true, () => removeRows(rows)],
        ['Avbryt', false, () => { unpick(rows); renderSegments(); }],
      ]));
      el.appendChild(g);
      i = j + 1;
      continue;
    }
    // Troligen video: en vit ruta med de första raderna, resten dolda, Ta bort och Behåll. Rader du markerar
    // här stannar i rutan, och knapparna gäller då bara de markerade.
    if (segs[i].aside) {
      const id = segs[i].aside;
      let j = i;
      while (j + 1 < segs.length && segs[j + 1].aside === id) j++;
      const n = j - i + 1;
      const rows = Array.from({ length: n }, (_, k) => i + k);
      const mine = rows.filter((k) => state.picked.has(k));
      const m = mine.length;
      const g = groupBox('clip', `${CLIP_SVG}<b>Troligen video</b><span>· ${fmt(segs[i].start)} – ${fmt(segs[j].end)} · ${n} ${n === 1 ? 'rad' : 'rader'}${m ? ` · ${m} markerade` : ''}</span>`);
      const open = state.openClips.has(id) || n <= 3 || m > 0;
      const shown = open ? n : 2;
      for (let k = i; k < i + shown; k++) g.appendChild(segRow(segs[k], k));
      if (!open) {
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'link more';
        more.textContent = `och ${n - shown} rader till`;
        more.onclick = () => { state.openClips.add(id); renderSegments(); };
        g.appendChild(more);
      }
      g.appendChild(pillButtons(m ? [
        [`Behåll ${m} markerade`, true, () => { mine.forEach((k) => delete segs[k].aside); unpick(mine); renderSegments(); resummarize(); }],
        [`Ta bort ${m} markerade`, false, () => removeRows(mine)],
        ['Avbryt', false, () => { unpick(mine); renderSegments(); }],
      ] : [
        ['Ta bort', true, () => removeRows(rows)],
        ['Behåll', false, () => { rows.forEach((k) => delete segs[k].aside); renderSegments(); resummarize(); }],
      ]));
      el.appendChild(g);
      i = j + 1;
      continue;
    }
    el.appendChild(segRow(segs[i], i));
    i++;
  }
  fitAll();
}

function fillSummary(s) {
  $('summary').value = s.summary || '';
  $('decisions').value = (s.decisions || []).join('\n');
  $('todos').value = (s.todos || []).map((t) => (t.owner ? `${t.text} @${t.owner}` : t.text)).join('\n');
  const by = s.by === 'llm' ? 'Lokal språkmodell' : `Utan språkmodell (${s.by || 'regler'})`;
  const clips = state.result && state.result.segments.some((x) => x.aside);
  $('summaryBy').textContent = clips ? `${by}. Videon är inte med i sammanfattningen.` : by;
}

// Sammanfattar om. Rader som troligen är video och inte har fått Behåll räknas inte med.
async function resummarize() {
  $('btnResummarize').disabled = true;
  $('summaryBy').textContent = 'Sammanfattar…';
  try {
    fillSummary(await api.meeting.summarize(namedSegments().filter((s) => !s.aside)));
  } catch (e) {
    $('summaryBy').textContent = 'Misslyckades: ' + e.message;
  } finally {
    $('btnResummarize').disabled = false;
  }
}
$('btnResummarize').onclick = resummarize;

function namedSegments() {
  return state.result.segments.map((s) => ({ ...s, speaker: state.speakerNames[s.speaker] || s.speaker }));
}

// Hela transkriptet som text. Kopieras av huvudprocessen: sidan själv får inte skriva till urklipp
// (Speak ger fönstren inga behörigheter utom mikrofonen).
$('btnCopy').onclick = async () => {
  const title = $('title').value.trim();
  const rows = namedSegments().map((s) => `[${fmt(s.start)}] ${s.speaker}: ${s.text}`).join('\n');
  try {
    await api.meeting.copyText(title ? `${title}\n\n${rows}` : rows);
    $('btnCopy').textContent = 'Kopierat';
  } catch (e) {
    $('btnCopy').textContent = 'Gick inte att kopiera';
    console.error(e);
  }
  setTimeout(() => ($('btnCopy').textContent = 'Kopiera som text'), 1500);
};

// ---- Innan du läser: frågekort ----
const PLAY_SVG = '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1.2v7.6L8.6 5z" fill="currentColor"></path></svg>';
const TICK_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
let clip = null;

// Spelar upp en bit av mötets ljudfil (den ligger kvar på datorn tills anteckningen sparas).
function playClip(start, end, btn) {
  if (clip) { clip.audio.pause(); if (clip.btn) clip.btn.classList.remove('on'); }
  const p = (state.result && state.result.wavPath) || state.audioPath;
  if (!p || (clip && clip.btn === btn)) { clip = null; return; }
  const audio = new Audio('file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F'));
  clip = { audio, btn };
  btn.classList.add('on');
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, start - 0.2); audio.play().catch(() => {}); });
  audio.addEventListener('timeupdate', () => { if (audio.currentTime >= end + 0.3) { audio.pause(); btn.classList.remove('on'); clip = null; } });
  audio.addEventListener('error', () => { btn.classList.remove('on'); btn.title = 'Ljudfilen finns inte kvar'; clip = null; });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// En replik med uppspelningsknapp.
function quoteRow(seg, { clip: oneLine = true, mark } = {}) {
  const row = el('div', 'quote');
  const b = el('button', 'play');
  b.type = 'button';
  b.setAttribute('aria-label', `Spela upp ${fmt(seg.start)}`);
  b.innerHTML = PLAY_SVG;
  b.onclick = () => playClip(seg.start, seg.end, b);
  const x = el('span', 'x' + (oneLine ? ' clip' : ''));
  if (mark && seg.text.includes(mark)) {
    const [pre, ...rest] = seg.text.split(mark);
    x.append(pre, el('span', 'mark', mark), rest.join(mark));
  } else x.textContent = seg.text;
  row.append(b, el('span', 't', fmt(seg.start)), x);
  return row;
}

// Några repliker från en talare, utspridda över hela mötet, de längre först.
function examples(speaker, n = 5) {
  const all = state.result.segments.filter((s) => s.speaker === speaker && s.text.length > 12);
  if (all.length <= n) return all;
  const out = [];
  for (let k = 0; k < n; k++) {
    const part = all.slice(Math.floor((k * all.length) / n), Math.floor(((k + 1) * all.length) / n));
    out.push(part.sort((a, b) => b.text.length - a.text.length)[0]);
  }
  return out;
}

function quoteBox(title, segs, count, oneLine = true) {
  const box = el('div', 'quotes');
  const h = el('div', 'qh');
  h.append(el('span', '', title));
  if (count) h.append(el('span', '', `${count} repliker`));
  box.appendChild(h);
  segs.forEach((s) => box.appendChild(quoteRow(s, { clip: oneLine })));
  return box;
}

function answerButton(text, primary, fn) {
  const b = el('button', primary ? 'primary' : '', text);
  b.type = 'button';
  b.onclick = fn;
  return b;
}

function nameOf(sp) { return state.speakerNames[sp] || sp; }
function countOf(sp) { return state.result.segments.filter((s) => s.speaker === sp).length; }

function showQuestions() {
  const qs = state.questions;
  // Frågor som inte längre gäller (talaren finns inte kvar) hoppas över.
  while (state.qIndex < qs.length && !questionValid(qs[state.qIndex])) state.qIndex++;
  if (state.qIndex >= qs.length) return finishQuestions();
  const q = qs[state.qIndex];
  $('qMeta').textContent = `${$('title').value.trim() || 'Möte'} · ${fmt(state.result.durationSec)} · ${state.result.speakers.length} talare`;
  const left = qs.length - state.qIndex;
  $('qCount').textContent = left === 1 ? 'En sak Speak vill ha hjälp med.' : `${['', 'En', 'Två', 'Tre', 'Fyra', 'Fem', 'Sex', 'Sju'][left] || left} saker Speak vill ha hjälp med.`;
  const done = $('qDone');
  done.innerHTML = '';
  const known = Object.entries(state.speakerNames).filter(([sp, n]) => n !== sp);
  if (known.length) {
    done.appendChild(el('span', 'status', 'Redan klart'));
    for (const [sp, n] of known) { const c = el('span', 'chip2'); c.innerHTML = TICK_SVG; c.append(`${n}, ${sp}`); done.appendChild(c); }
  }
  const dots = $('qDots');
  dots.innerHTML = '';
  qs.forEach((_, k) => dots.appendChild(el('i', k < state.qIndex ? 'done' : k === state.qIndex ? 'now' : '')));
  $('qStep').textContent = `Fråga ${state.qIndex + 1} av ${qs.length}`;
  const card = $('qCard');
  card.innerHTML = '';
  card.scrollTop = 0;
  const head = el('div', 'qhead');
  const title = el('div', 'qtitle');
  const answers = el('div', 'answers');
  if (q.type === 'same') {
    head.append('Rösterna liknar varandra. Lyssna på några repliker från var och en.');
    title.textContent = `Är ${nameOf(q.a)} och ${nameOf(q.b)} samma person?`;
    const two = el('div', 'twocol');
    two.append(quoteBox(nameOf(q.a), examples(q.a, 4), countOf(q.a), false), quoteBox(nameOf(q.b), examples(q.b, 4), countOf(q.b), false));
    card.append(head, title, two);
    answers.append(
      answerButton('Ja, samma person', true, () => { mergeSpeaker(q.b, q.a); state.qChanged = true; nextQuestion(); }),
      answerButton('Nej, två personer', false, nextQuestion),
    );
  } else if (q.type === 'name') {
    head.append(`${nameOf(q.speaker)} · ${countOf(q.speaker)} repliker i mötet`);
    title.textContent = `Är ${nameOf(q.speaker)} ${q.name}?`;
    card.append(head, title, quoteBox(`Det här säger ${nameOf(q.speaker)}, från hela mötet`, examples(q.speaker, 5), countOf(q.speaker)));
    const ev = (q.evidence || []).map(([i, j]) => [state.result.segments[i], state.result.segments[j]]).filter(([a, b]) => a && b);
    if (ev.length) {
      const box = el('div', 'quotes');
      box.appendChild(el('div', 'qh', `Varför ${q.name}`));
      for (const [a, b] of ev) {
        box.appendChild(quoteRow(a, { clip: false, mark: q.name }));
        if (b !== a) box.appendChild(quoteRow(b, { clip: false }));
      }
      card.appendChild(box);
      card.appendChild(el('div', 'why', `${q.name} nämns, och ${nameOf(q.speaker)} svarar direkt efteråt.`));
    }
    const other = el('input');
    other.type = 'text';
    other.placeholder = 'Nej, det är …';
    const setName = (n) => { if (n) { state.speakerNames[q.speaker] = n; state.qChanged = true; } nextQuestion(); };
    other.onkeydown = (e) => { if (e.key === 'Enter') setName(other.value.trim()); };
    answers.append(answerButton(`Ja, det är ${q.name}`, true, () => setName(q.name)), other, answerButton('Vet inte', false, nextQuestion));
  } else if (q.type === 'word') {
    const i = findWord(q);
    const seg = state.result.segments[i];
    head.append(`Vid ${seg ? fmt(seg.start) : ''}`);
    title.textContent = `Rättade jag rätt: ”${q.to}”?`;
    if (seg) {
      const box = el('div', 'quotes');
      box.appendChild(el('div', 'qh', `Taligenkänningen hörde ”${q.from}”. Korrläsningen skrev ”${q.to}”.`));
      box.appendChild(quoteRow(seg, { clip: false, mark: q.to }));
      card.appendChild(box);
    }
    card.prepend(head);
    card.insertBefore(title, card.children[1] || null);
    card.appendChild(el('div', 'why', 'Säger du ja läggs ordet i ordlistan, så blir det rätt nästa gång.'));
    answers.append(
      answerButton(`Ja, ”${q.to}”`, true, async () => { await addToVocabulary(q.to); nextQuestion(); }),
      answerButton(`Nej, ”${q.from}”`, false, () => { if (seg) { seg.text = seg.text.replace(q.to, q.from); state.qChanged = true; } nextQuestion(); }),
      answerButton('Vet inte', false, nextQuestion),
    );
  }
  if (q.type !== 'word') { card.prepend(title); card.prepend(head); }
  card.appendChild(answers);
  show('questions');
}

function questionValid(q) {
  const sp = state.result.speakers;
  if (q.type === 'same') return sp.includes(q.a) && sp.includes(q.b);
  if (q.type === 'name') return sp.includes(q.speaker) && nameOf(q.speaker) === q.speaker;
  if (q.type === 'word') return findWord(q) >= 0;
  return false;
}

// Repliken med det rättade ordet, närmast där det stod från början (rader kan ha tagits bort).
function findWord(q) {
  const segs = state.result.segments;
  let best = -1;
  segs.forEach((s, k) => { if (s.text.includes(q.to) && (best < 0 || Math.abs(k - q.index) < Math.abs(best - q.index))) best = k; });
  return best;
}

async function addToVocabulary(word) {
  try {
    const s = await api.settings.get();
    const list = String(s.vocabulary || '').split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
    if (!list.some((t) => t.toLowerCase() === word.toLowerCase())) await api.settings.set({ vocabulary: [...list, word].join(', ') });
  } catch (e) { console.error(e); }
}

function nextQuestion() {
  if (clip) { clip.audio.pause(); clip = null; }
  state.qIndex++;
  showQuestions();
}

function finishQuestions() {
  if (clip) { clip.audio.pause(); clip = null; }
  show('result');
  renderSpeakers();
  renderSegments();
  fitAll();
  updateQuestionsLeft();
  // Namn och sammanslagna talare ska med i sammanfattningen.
  if (state.qChanged) { state.qChanged = false; resummarize(); }
}

// Hoppade du över frågorna finns de kvar bakom en länk i resultatet.
function updateQuestionsLeft() {
  const left = (state.questions || []).slice(state.qIndex).filter(questionValid).length;
  const b = $('btnQuestionsLeft');
  b.classList.toggle('hidden', !left);
  b.textContent = left === 1 ? '1 fråga kvar' : `${left} frågor kvar`;
}
$('btnQuestionsLeft').onclick = () => showQuestions();
$('btnSkipQuestions').onclick = () => finishQuestions();

// ---- Spara ----
async function renderInboxes() {
  state.settings = await api.settings.get();
  const el = $('inboxes');
  el.innerHTML = '';
  state.settings.inboxes.forEach((ib, i) => {
    const div = document.createElement('div');
    div.className = 'radio';
    const r = document.createElement('input');
    r.type = 'radio'; r.name = 'inbox'; r.value = String(i); r.id = `inbox${i}`;
    r.checked = i === state.settings.defaultInbox;
    const l = document.createElement('label'); l.htmlFor = r.id;
    l.textContent = ib.label;
    const small = document.createElement('small'); small.textContent = ib.path; l.appendChild(small);
    div.append(r, l);
    el.appendChild(div);
  });
}

$('btnChoose').onclick = async () => {
  const f = await api.meeting.chooseFolder();
  if (f) { state.customFolder = f; $('customPath').textContent = f; $('inboxCustom').checked = true; }
};

$('btnSave').onclick = async () => {
  const sel = document.querySelector('input[name=inbox]:checked');
  const folder = sel && sel.value === 'custom' ? state.customFolder : state.settings.inboxes[Number(sel ? sel.value : state.settings.defaultInbox)].path;
  if (!folder) return ($('saveStatus').textContent = 'Välj en mapp först.');
  const todos = $('todos').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*?)\s*@(.+)$/);
    return m ? { text: m[1].trim(), owner: m[2].trim() } : { text: l };
  });
  const note = {
    title: $('title').value.trim(),
    date: state.startedAt ? new Date(state.startedAt).toISOString() : new Date().toISOString(),
    durationSec: state.result.durationSec,
    speakers: state.result.speakers.map((s) => state.speakerNames[s] || s),
    segments: namedSegments(),
    languages: state.result.languages,
    summary: $('summary').value,
    decisions: $('decisions').value.split('\n').map((l) => l.trim()).filter(Boolean),
    todos,
    consent: state.consent,
    model: state.result.model,
    audioPath: state.audioPath,
  };
  $('btnSave').disabled = true;
  $('saveStatus').textContent = 'Sparar…';
  try {
    const p = await api.meeting.save(note, folder);
    $('saveStatus').innerHTML = '';
    const a = document.createElement('button'); a.className = 'small'; a.textContent = 'Visa i Finder'; a.onclick = () => api.open.folder(p);
    const b = document.createElement('button'); b.className = 'small'; b.textContent = 'Öppna i Obsidian'; b.onclick = () => api.open.path(p);
    state.saved = true;
    report();
    $('saveStatus').append(`Sparad: ${p.split('/').pop()} `, a, ' ', b);
  } catch (e) {
    $('saveStatus').textContent = 'Kunde inte spara: ' + e.message;
  } finally {
    $('btnSave').disabled = false;
  }
};

// Börja om: tillbaka till starten. Frågar först om anteckningen inte är sparad.
$('btnNew').onclick = async () => {
  if (state.result && !state.saved && !confirm('Anteckningen är inte sparad. Börja om ändå?')) return;
  // Ljudfilen behövs inte längre (om du inte valt att behålla inspelningar).
  const s = state.settings || (await api.settings.get());
  if (state.audioPath && !s.keepRecordings) api.meeting.discardAudio(state.audioPath);
  state.result = null;
  state.saved = false;
  state.audioPath = null;
  $('title').value = '';
  $('about').value = '';
  show('idle');
};

show('idle');
// Öppnat via "Ladda upp fil" i huvudfönstret: välj fil direkt.
if (new URLSearchParams(location.search).get('upload')) upload();
