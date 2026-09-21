const $ = (id) => document.getElementById(id);
const api = window.diktera;
const SPEAKER_COLORS = ['var(--sp1)', 'var(--sp2)', 'var(--sp3)', 'var(--sp4)', 'var(--sp5)', 'var(--sp6)'];

const state = { result: null, speakerNames: {}, customFolder: null, settings: null, audioPath: null, consent: false, startedAt: null };
let timerHandle = null;

function show(section) {
  for (const id of ['idle', 'recording', 'processing', 'result']) $(id).classList.toggle('hidden', id !== section);
}

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
  return { speakerCount: speakerCount(), language: $('language').value || undefined };
}

function fail(msg) {
  clearInterval(timerHandle);
  $('errorText').textContent = msg;
  $('errorBox').classList.remove('hidden');
  show(state.result ? 'result' : 'idle');
}
$('errorClose').onclick = () => $('errorBox').classList.add('hidden');

function speakerColor(name) {
  const i = state.result ? state.result.speakers.indexOf(name) : 0;
  return SPEAKER_COLORS[Math.max(0, i) % SPEAKER_COLORS.length];
}

// ---- Nivåmätare: 40 staplar som "rullar" ----
const BAR_COUNT = 40;
const levels = new Array(BAR_COUNT).fill(0);
(function buildBars() {
  const el = $('bars');
  for (let i = 0; i < BAR_COUNT; i++) el.appendChild(document.createElement('i'));
})();
function pushLevel(level) {
  levels.shift();
  levels.push(level);
  const bars = $('bars').children;
  for (let i = 0; i < BAR_COUNT; i++) {
    bars[i].style.height = `${8 + Math.round(levels[i] * 56)}px`;
    bars[i].classList.toggle('hot', levels[i] > 0.6);
  }
}

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
    levels.fill(0);
    $('sources').textContent = 'Mikrofon';
    show('recording');
    timerHandle = setInterval(() => ($('timer').textContent = fmt((Date.now() - state.startedAt) / 1000)), 500);
  } catch (e) {
    fail('Kunde inte starta inspelning: ' + e.message);
  }
};

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

$('btnUpload').onclick = async () => {
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
};

// ---- Progress ----
const STEP_ORDER = ['load', 'convert', 'diarize', 'transcribe', 'summarize'];
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
  if (p.phase === 'transcribe' && p.total) {
    frac = Math.min(1, p.done / p.total);
    text = `Transkriberar talartur ${Math.min(p.total, Math.floor(p.done) + 1)} av ${p.total}`;
  } else if (p.phase === 'diarize') frac = p.done ? 1 : 0;
  else if (p.phase === 'summarize') frac = 1;
  $('progressBar').style.width = `${Math.round(frac * 100)}%`;
  $('progressText').textContent = text;
}
api.meeting.onProgress(setProgress);

// ---- Resultat ----
function showResult(r) {
  state.saved = false;
  state.result = r;
  state.speakerNames = Object.fromEntries(r.speakers.map((s) => [s, s]));
  $('resultTitle').textContent = $('title').value.trim() || 'Möte';
  const d = new Date(state.startedAt || Date.now());
  $('meta').textContent = `${d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmt(r.durationSec)} · ${r.speakers.length} talare · ${(r.languages || []).join(', ') || '–'} · ${r.model}${r.timing ? ` · ${r.engine === 'whisper.cpp' ? 'Metal' : 'CPU'} ${r.timing.totalSec.toFixed(0)} s (${r.timing.speed.toFixed(1)}× realtid)` : ''}`;
  renderSpeakers();
  renderSegments();
  fillSummary(r.summary);
  renderInboxes();
  $('saveStatus').textContent = '';
  show('result');
}

function renderSpeakers() {
  const el = $('speakers');
  el.innerHTML = '';
  for (const s of state.result.speakers) {
    const wrap = document.createElement('div');
    wrap.className = 'sp';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = speakerColor(s);
    dot.style.width = '12px'; dot.style.height = '12px';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = state.speakerNames[s];
    input.placeholder = s;
    input.oninput = () => { state.speakerNames[s] = input.value.trim() || s; renderSegments(); };
    wrap.append(dot, input);
    el.appendChild(wrap);
  }
  const span = document.createElement('span');
  span.className = 'status';
  span.style.marginLeft = 'auto';
  span.textContent = `00:00 – ${fmt(state.result.durationSec)}`;
  el.appendChild(span);
}

function renderSegments() {
  const el = $('segments');
  el.innerHTML = '';
  state.result.segments.forEach((seg, i) => {
    const row = document.createElement('div');
    row.className = 'seg';
    row.dataset.i = String(i);
    const t = document.createElement('div'); t.className = 't'; t.textContent = fmt(seg.start);
    // Vertikal tidsaxel: en färgad stapel per replik, höjd efter längd.
    const lane = document.createElement('div'); lane.className = 'lane';
    lane.style.background = speakerColor(seg.speaker);
    lane.style.minHeight = `${Math.max(44, Math.min(160, Math.round((seg.end - seg.start) * 6)))}px`;
    lane.title = `${fmt(seg.start)} – ${fmt(seg.end)}`;
    const body = document.createElement('div'); body.className = 'body';
    const sp = document.createElement('div'); sp.className = 'sp';
    const name = document.createElement('span'); name.textContent = state.speakerNames[seg.speaker] || seg.speaker;
    sp.append(name);
    if (seg.lang) { const l = document.createElement('span'); l.className = 'lang'; l.textContent = seg.lang; sp.appendChild(l); }
    const ta = document.createElement('textarea'); ta.value = seg.text; ta.rows = Math.max(1, Math.ceil(seg.text.length / 80));
    ta.oninput = () => (state.result.segments[i].text = ta.value);
    body.append(sp, ta);
    row.append(t, lane, body);
    el.appendChild(row);
  });
}

function fillSummary(s) {
  $('summary').value = s.summary || '';
  $('decisions').value = (s.decisions || []).join('\n');
  $('todos').value = (s.todos || []).map((t) => (t.owner ? `${t.text} @${t.owner}` : t.text)).join('\n');
  $('summaryBy').textContent = s.by === 'llm' ? 'Lokal språkmodell' : `Utan språkmodell (${s.by || 'regler'})`;
}

$('btnResummarize').onclick = async () => {
  $('btnResummarize').disabled = true;
  $('summaryBy').textContent = 'Sammanfattar…';
  try {
    fillSummary(await api.meeting.summarize(namedSegments()));
  } catch (e) {
    $('summaryBy').textContent = 'Misslyckades: ' + e.message;
  } finally {
    $('btnResummarize').disabled = false;
  }
};

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
