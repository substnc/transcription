const $ = (id) => document.getElementById(id);
const api = window.diktera;
let S = null;
const progress = {};

async function load() {
  S = await api.settings.get();
  $('modelsDir').textContent = S.modelsDir;
  $('toggleShortcut').textContent = S.toggleShortcut.replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, '');
  const hk = $('hotkey');
  hk.innerHTML = '';
  for (const [k, label] of Object.entries(S.keyLabels)) hk.add(new Option(label, k));
  hk.value = S.hotkey;
  $('hotkeyMode').value = S.hotkeyMode;
  $('language').value = S.language;
  $('primary').value = S.primary;
  for (const id of ['autoPaste', 'restoreClipboard', 'voiceCommands', 'diarize', 'keepRecordings', 'useLlm', 'llmDictation', 'launchAtLogin']) $(id).checked = !!S[id];
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
bindSimple('primary', 'primary');
for (const id of ['autoPaste', 'restoreClipboard', 'voiceCommands', 'diarize', 'keepRecordings', 'useLlm', 'llmDictation', 'launchAtLogin']) bindSimple(id, id, 'checked');
$('ollamaModel').onchange = () => api.settings.set({ ollamaModel: $('ollamaModel').value });

// ---- Behörigheter ----
async function renderPerms() {
  const p = await api.perm.status();
  const mic = $('permMic');
  mic.textContent = p.microphone === 'granted' ? 'OK' : p.microphone === 'denied' ? 'Nekad' : 'Inte tillfrågad';
  mic.className = 'chip ' + (p.microphone === 'granted' ? 'ok' : 'warn');
  $('permAcc').textContent = p.accessibility ? 'OK' : 'Saknas';
  $('permAcc').className = 'chip ' + (p.accessibility ? 'ok' : 'warn');
  $('permHook').textContent = p.hotkeyActive ? 'Aktiv' : 'Inaktiv' + (p.hotkeyError ? ` (${p.hotkeyError})` : '');
  $('permHook').className = 'chip ' + (p.hotkeyActive ? 'ok' : 'warn');
}
$('btnMic').onclick = async () => { await api.perm.request('microphone'); renderPerms(); };
$('btnAcc').onclick = async () => { await api.perm.request('accessibility'); api.open.external('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); };
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
  if (p.phase === 'extract') return 'Packar upp…';
  if (p.total) return `${Math.round((p.done / p.total) * 100)} % av ${(p.total / 1e6).toFixed(0)} MB`;
  return `${(p.done / 1e6).toFixed(0)} MB`;
}

async function renderModels() {
  const st = await api.models.status();
  const wl = $('whisperList');
  wl.innerHTML = '';
  for (const [name, m] of Object.entries(st.whisper)) {
    const row = document.createElement('div');
    row.className = 'model';
    const left = document.createElement('div');
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'whisper'; radio.value = name; radio.checked = S.whisper === name; radio.disabled = !m.installed;
    radio.onchange = async () => { S = await api.settings.set({ whisper: name }); };
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = ' ' + name;
    left.append(radio, nm);
    const mid = document.createElement('div');
    mid.innerHTML = `<div class="note">${m.note} (${m.size})</div>`;
    const key = `whisper:${name}`;
    if (progress[key]) {
      const bar = document.createElement('div'); bar.className = 'bar';
      const i = document.createElement('i'); i.style.width = progress[key].total ? `${(progress[key].done / progress[key].total) * 100}%` : '10%'; bar.appendChild(i);
      const t = document.createElement('div'); t.className = 'note'; t.textContent = progressLine(key);
      mid.append(bar, t);
    }
    const right = document.createElement('div');
    const btn = document.createElement('button');
    if (progress[key]) { btn.textContent = 'Laddar ner…'; btn.disabled = true; }
    else if (m.installed) { btn.textContent = 'Ta bort'; btn.className = 'danger'; btn.onclick = async () => { if (confirm(`Ta bort whisper-${name}?`)) { await api.models.remove(name); renderModels(); } }; }
    else { btn.textContent = 'Ladda ner'; btn.onclick = () => install('whisper', name); }
    right.appendChild(btn);
    row.append(left, mid, right);
    wl.appendChild(row);
  }
  const al = $('auxList');
  al.innerHTML = '';
  for (const [key, m] of Object.entries(st.aux)) {
    const row = document.createElement('div');
    row.className = 'model';
    const left = document.createElement('div'); left.className = 'name'; left.textContent = { vad: 'Röst', segmentation: 'Talare', embedding: 'Röstavtryck' }[key] || key;
    const mid = document.createElement('div'); mid.innerHTML = `<div class="note">${m.label} (${m.size})</div>`;
    const pk = `aux:${key}`;
    if (progress[pk]) { const t = document.createElement('div'); t.className = 'note'; t.textContent = progressLine(pk); mid.appendChild(t); }
    const right = document.createElement('div');
    if (m.installed) { const c = document.createElement('span'); c.className = 'chip ok'; c.textContent = 'Installerad'; right.appendChild(c); }
    else { const b = document.createElement('button'); b.textContent = progress[pk] ? 'Laddar ner…' : 'Ladda ner'; b.disabled = !!progress[pk]; b.onclick = () => install('aux', key); right.appendChild(b); }
    row.append(left, mid, right);
    al.appendChild(row);
  }
}

async function install(kind, name) {
  const key = `${kind}:${name}`;
  progress[key] = { done: 0, total: 0 };
  renderModels();
  try {
    await api.models.install(kind, name);
    if (kind === 'whisper' && !S.whisper) await api.settings.set({ whisper: name });
  } catch (e) {
    alert(`Nedladdning misslyckades: ${e.message}`);
  }
  delete progress[key];
  renderModels();
}

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

$('btnMeeting').onclick = () => api.open.meeting();
$('btnRecordings').onclick = () => api.open.path(S.recordingsDir);
$('btnLogs').onclick = () => api.open.logs();

load();
