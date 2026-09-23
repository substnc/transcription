const $ = (id) => document.getElementById(id);
const api = window.diktera;
let S = null;
const progress = {};

async function load() {
  S = await api.settings.get();
  $('modelsDir').textContent = S.modelsDir;
  $('recordingsDir').textContent = S.recordingsDir;
  $('toggleShortcut').textContent = S.toggleShortcut.replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, '');
  const hk = $('hotkey');
  hk.innerHTML = '';
  for (const [k, label] of Object.entries(S.keyLabels)) hk.add(new Option(label, k));
  hk.value = S.hotkey;
  $('hotkeyMode').value = S.hotkeyMode;
  $('language').value = S.language;
  $('vocabulary').value = S.vocabulary || '';
  $('llmMode').value = !S.useLlm ? 'off' : S.llmDictation ? 'all' : 'meetings';
  for (const id of ['autoPaste', 'voiceCommands', 'diarize', 'keepRecordings', 'captureSystemAudio', 'launchAtLogin', 'showInDock']) $(id).checked = !!S[id];
  renderInboxes();
  await Promise.all([renderModels(), renderLlm(), renderPerms()]);
}

function bindSimple(id, key, type = 'value') {
  $(id).onchange = async () => {
    const v = type === 'checked' ? $(id).checked : $(id).value;
    S = { ...S, ...(await api.settings.set({ [key]: v })) };
  };
}
bindSimple('hotkey', 'hotkey');
bindSimple('hotkeyMode', 'hotkeyMode');
bindSimple('language', 'language');
bindSimple('vocabulary', 'vocabulary');
for (const id of ['autoPaste', 'voiceCommands', 'diarize', 'keepRecordings', 'captureSystemAudio', 'launchAtLogin', 'showInDock']) bindSimple(id, id, 'checked');
$('llmMode').onchange = async () => {
  const m = $('llmMode').value;
  S = { ...S, ...(await api.settings.set({ useLlm: m !== 'off', llmDictation: m === 'all' })) };
};
$('ollamaModel').onchange = () => api.settings.set({ ollamaModel: $('ollamaModel').value });

// ---- Behörigheter ----
async function renderPerms() {
  const p = await api.perm.status();
  const mic = $('permMic');
  mic.textContent = p.microphone === 'granted' ? 'OK' : p.microphone === 'denied' ? 'Nekad' : 'Inte tillfrågad';
  mic.className = 'chip ' + (p.microphone === 'granted' ? 'ok' : 'warn');
  $('permScreen').textContent = p.screen === 'granted' ? 'OK' : p.screen === 'denied' ? 'Nekad' : 'Inte tillfrågad';
  $('permScreen').className = 'chip ' + (p.screen === 'granted' ? 'ok' : 'warn');
  $('permAcc').textContent = p.accessibility ? 'OK' : 'Saknas';
  $('permAcc').className = 'chip ' + (p.accessibility ? 'ok' : 'warn');
  $('permHook').textContent = p.hotkeyActive ? 'Aktiv' : 'Inaktiv' + (p.hotkeyError ? ` (${p.hotkeyError})` : '');
  $('permHook').className = 'chip ' + (p.hotkeyActive ? 'ok' : 'warn');
}
$('btnMic').onclick = async () => { await api.perm.request('microphone'); renderPerms(); };
$('btnAcc').onclick = async () => { await api.perm.request('accessibility'); api.open.external('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); };
$('btnScreen').onclick = () => api.open.external('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
$('btnInput').onclick = () => api.open.external('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
setInterval(renderPerms, 3000);

$('btnTest').onclick = async () => {
  $('testStatus').textContent = 'Prata nu…';
  await api.test.dictate();
  setTimeout(async () => { await api.test.stop(); $('testStatus').textContent = 'Resultatet klistras in där markören står, eller läggs på urklipp.'; }, 3000);
};

// ---- Modeller ----
function progressLine(key) {
  const p = progress[key];
  if (!p) return '';
  if (p.phase === 'setup' && !p.total) return p.text || 'Installerar…';
  if (p.phase === 'extract') return 'Packar upp…';
  if (p.total) return `${Math.round((p.done / p.total) * 100)} % av ${(p.total / 1e6).toFixed(0)} MB`;
  return `${(p.done / 1e6).toFixed(0)} MB`;
}

// Visar vilken motor de valda modellerna körs med. Bra vid felsökning: "Metal" betyder whisper.cpp på grafikkretsen.
async function renderEngine() {
  const el = $('engineStatus');
  try {
    const describe = (info) => (!info.installed ? 'inte installerad' : info.ggml ? 'Metal' : info.py ? 'CPU (NeMo, Python)' : 'CPU (ONNX)');
    const d = await api.models.engineInfo(S.whisperDictation || S.whisperMeeting);
    const m = await api.models.engineInfo(S.whisperMeeting || S.whisperDictation);
    if ((d.ggml || m.ggml) && !d.whisperCli) { el.textContent = 'whisper-cli saknas i appen. Installera om från senaste bygget.'; el.className = 'chip bad'; return; }
    el.textContent = `Diktering: ${describe(d)} · Möten: ${describe(m)}`;
    el.className = 'chip ' + (d.installed && m.installed && d.ggml && m.ggml ? 'ok' : 'warn');
  } catch (e) {
    el.textContent = 'Kunde inte läsa motorstatus: ' + e.message; el.className = 'chip bad';
  }
}

// De två valen: en snabb modell för diktering, en noggrann för möten. Bara installerade går att välja.
function renderSlots(st) {
  for (const key of ['whisperDictation', 'whisperMeeting', 'liveModel']) {
    const id = key;
    const sel = $(id);
    sel.innerHTML = '';
    const installed = Object.entries(st.whisper).filter(([, m]) => m.installed).map(([n]) => n);
    if (key === 'liveModel') sel.add(new Option('Av', ''));
    else if (!installed.length) sel.add(new Option('Ingen modell installerad', ''));
    for (const n of installed) sel.add(new Option(n, n));
    if (S[key] && !installed.includes(S[key])) sel.add(new Option(S[key] + ' (saknas)', S[key]));
    sel.value = S[key] || '';
    sel.onchange = async () => { S = { ...S, ...(await api.settings.set({ [key]: sel.value })) }; renderEngine(); };
  }
}

async function renderModels() {
  const st = await api.models.status();
  renderSlots(st);
  renderEngine();
  const wl = $('whisperList');
  wl.innerHTML = '';
  for (const [name, m] of Object.entries(st.whisper)) {
    const row = document.createElement('div');
    row.className = 'model';
    const left = document.createElement('div');
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = name;
    left.append(nm);
    const mid = document.createElement('div');
    mid.innerHTML = `<div class="note">${m.ggml ? 'Metal · ' : m.py ? 'NeMo · ' : ''}${m.note}${m.size ? ' (' + m.size + ')' : ''}</div>`;
    const key = `whisper:${name}`;
    if (progress[key]) {
      const bar = document.createElement('div'); bar.className = 'bar';
      const i = document.createElement('i'); i.style.width = progress[key].total ? `${(progress[key].done / progress[key].total) * 100}%` : '10%'; bar.appendChild(i);
      const t = document.createElement('div'); t.className = 'note'; t.textContent = progressLine(key);
      mid.append(bar, t);
    }
    const right = document.createElement('div');
    const btn = document.createElement('button');
    if (progress[key]) { btn.textContent = m.py ? 'Installerar…' : 'Laddar ner…'; btn.disabled = true; }
    else if (m.installed) { btn.textContent = 'Ta bort'; btn.className = 'danger'; btn.onclick = async () => { if (confirm(`Ta bort whisper-${name}?`)) { await api.models.remove(name); S = await api.settings.get(); renderModels(); } }; }
    else if (m.manual) { btn.textContent = 'Importera'; btn.onclick = importModel; }
    else if (m.py) { btn.textContent = 'Installera'; btn.onclick = () => { if (confirm('Pianissimo installeras med Python, PyTorch och NeMo, som modellkortet beskriver. Det hämtar cirka 4,5 GB en gång och tar några minuter. Sedan körs allt utan nät. Fortsätt?')) install('whisper', name); }; }
    else { btn.textContent = 'Ladda ner'; btn.onclick = () => install('whisper', name); }
    right.appendChild(btn);
    row.append(left, mid, right);
    wl.appendChild(row);
  }
  // Talarmodellerna som en enhet.
  const auxKeys = Object.keys(st.aux);
  const missing = auxKeys.filter((k) => !st.aux[k].installed);
  const busy = auxKeys.some((k) => progress[`aux:${k}`]);
  $('auxStatus').textContent = busy ? progressLine(`aux:${auxKeys.find((k) => progress[`aux:${k}`])}`) : missing.length ? 'Saknas' : 'Installerade';
  $('auxStatus').className = 'chip ' + (missing.length ? 'warn' : 'ok');
  $('btnAux').classList.toggle('hidden', !missing.length && !busy);
  $('btnAux').disabled = busy;
  $('btnAux').onclick = async () => { for (const k of missing) await install('aux', k); };
}

async function install(kind, name) {
  const key = `${kind}:${name}`;
  progress[key] = { done: 0, total: 0 };
  renderModels();
  try {
    await api.models.install(kind, name);
    if (kind === 'whisper' && !S.whisperDictation) S = { ...S, ...(await api.settings.set({ whisperDictation: name })) };
  } catch (e) {
    alert(`Nedladdning misslyckades: ${e.message}`);
  }
  delete progress[key];
  renderModels();
}

async function importModel() {
  try {
    const r = await api.models.import();
    if (r) { S = await api.settings.get(); renderModels(); }
  } catch (e) {
    alert('Import misslyckades: ' + e.message);
  }
}
$('btnImport').onclick = importModel;

let renderTimer = null;
api.models.onProgress((p) => {
  progress[`${p.kind}:${p.name}`] = p;
  if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; renderModels(); }, 300);
});

// ---- Ollama ----
async function renderLlm() {
  const st = await api.llm.status();
  const chip = $('llmStatus');
  chip.textContent = st.ok ? `Ollama kör (${st.models.length} modeller)` : 'Ollama hittas inte på 127.0.0.1:11434';
  chip.className = 'chip ' + (st.ok ? 'ok' : 'warn');
  const sel = $('ollamaModel');
  sel.innerHTML = '';
  if (!st.models.length) sel.add(new Option('Ingen modell tillgänglig', ''));
  for (const m of st.models) sel.add(new Option(m, m));
  if (S.ollamaModel && !st.models.includes(S.ollamaModel)) sel.add(new Option(S.ollamaModel + ' (saknas)', S.ollamaModel));
  sel.value = S.ollamaModel || (st.models[0] || '');
  if (!S.ollamaModel && st.models[0]) api.settings.set({ ollamaModel: st.models[0] });
}
$('btnLlmRefresh').onclick = renderLlm;
$('ollamaLink').onclick = (e) => { e.preventDefault(); alert('Ollama laddas ner från ollama.com. Speak öppnar inga webbsidor själv.'); };

// ---- Inkorgar ----
function renderInboxes() {
  const el = $('inboxList');
  el.innerHTML = '';
  S.inboxes.forEach((ib, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    const r = document.createElement('input'); r.type = 'radio'; r.name = 'defaultInbox'; r.checked = S.defaultInbox === i; r.title = 'Förvald';
    r.onchange = () => api.settings.set({ defaultInbox: i });
    const label = document.createElement('input'); label.type = 'text'; label.value = ib.label; label.style.width = '200px';
    const p = document.createElement('input'); p.type = 'text'; p.value = ib.path; p.style.flex = '1';
    const save = async () => { const inboxes = S.inboxes.map((x, j) => (j === i ? { label: label.value, path: p.value } : x)); S = await api.settings.set({ inboxes }); };
    label.onchange = save; p.onchange = save;
    row.append(r, label, p);
    el.appendChild(row);
  });
}

$('btnRecordingsDir').onclick = async () => { const p = await api.settings.chooseRecordings(); if (p) { S = await api.settings.get(); $('recordingsDir').textContent = p; } };
$('btnMeeting').onclick = () => api.open.meeting();
$('btnRecordings').onclick = () => api.open.path(S.recordingsDir);
$('btnLogs').onclick = () => api.open.logs();

load();
