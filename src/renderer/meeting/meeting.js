const $ = (id) => document.getElementById(id);
const api = window.diktera;

const state = { result: null, speakerNames: {}, customFolder: null, settings: null, audioPath: null, consent: false, startedAt: null };
let timerHandle = null;

// Mötessidans läge rapporteras till huvudsidan och menyn: spelar in, transkriberar, klart eller inget.
let current = 'idle';
function report(extra = {}) {
  const title = $('title').value.trim();
  const st = current === 'recording' ? 'recording' : current === 'processing' ? 'processing' : current === 'result' && !state.saved ? 'done' : 'idle';
  api.meeting.report({ state: st, title, startedAt: state.startedAt, ...extra });
}

function show(section) {
  for (const id of ['idle', 'recording', 'processing', 'result']) $(id).classList.toggle('hidden', id !== section);
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
  return { speakerCount: speakerCount(), language: $('language').value || undefined, title: $('title').value.trim() };
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
  state.speakerNames = Object.fromEntries(r.speakers.map((s) => [s, s]));
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
  show('result');
  fitAll();
}
window.addEventListener('resize', () => $('segments').querySelectorAll('textarea').forEach(fitText));

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
      state.result.segments.forEach((seg) => { if (seg.speaker === s) seg.speaker = other; });
      state.result.speakers = state.result.speakers.filter((o) => o !== s);
      delete state.speakerNames[s];
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

$('btnCopy').onclick = async () => {
  const text = namedSegments().map((s) => `[${fmt(s.start)}] ${s.speaker}: ${s.text}`).join('\n');
  await navigator.clipboard.writeText(text);
  $('btnCopy').textContent = 'Kopierat';
  setTimeout(() => ($('btnCopy').textContent = 'Kopiera som text'), 1200);
};

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
  show('idle');
};

show('idle');
// Öppnat via "Ladda upp fil" i huvudfönstret: välj fil direkt.
if (new URLSearchParams(location.search).get('upload')) upload();
