// Huvudfönstret: Diktering och Möten. Första gången visas en välkomstsida med tre steg.
const $ = (id) => document.getElementById(id);
const api = window.diktera;

$('icon').appendChild(window.SpeakIcon.svg(62, '#ffffff'));
$('iconBig').appendChild(window.SpeakIcon.svg(84, '#ffffff'));

// Kort namn på tangenten, till exempel "Vänster ⌃ (Control)" blir "⌃".
function keyCap(label) {
  const m = String(label).match(/[⌃⌥⌘⇧]|Fn|F\d+/);
  return m ? m[0] : label;
}
const engineLabel = (name, st) => {
  if (!name) return 'ingen modell';
  const m = st.whisper[name];
  if (!m || !m.installed) return `${name} saknas`;
  return `${name.replace(/-metal$/, '')} · ${m.ggml ? 'Metal' : m.py ? 'NeMo' : 'CPU'}`;
};

async function render() {
  const S = await api.settings.get();
  const label = S.keyLabels[S.hotkey] || S.hotkey;
  $('keyCap').textContent = keyCap(label);
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  $('keyText').textContent = `${S.hotkeyMode === 'hold' ? 'Håll in' : 'Tryck'} ${lower}, var du än skriver`;
  $('wKey').textContent = lower;
  let st = null;
  try { st = await api.models.status(); } catch { /* motorn startar fortfarande */ }
  if (st) {
    $('dictModel').textContent = engineLabel(S.whisperDictation || S.whisperMeeting, st);
    $('meetModel').textContent = engineLabel(S.whisperMeeting || S.whisperDictation, st);
    const d = st.whisper[S.whisperDictation];
    const ready = d && d.installed && st.aux.vad.installed;
    $('wModels').textContent = ready ? 'Klart' : 'Saknas';
    $('wModels').className = 'chip ' + (ready ? '' : 'warn');
    $('wModelsBtn').classList.toggle('hidden', !!ready);
  }
  try {
    const llm = await api.llm.status();
    $('footStatus').textContent = `Allt körs på den här datorn${llm.ok && S.useLlm && S.ollamaModel ? ` · Ollama: ${S.ollamaModel}` : ''}`;
  } catch { /* Ollama saknas */ }
  const p = await api.perm.status();
  const permOk = p.microphone === 'granted' && p.accessibility && p.hotkeyActive;
  $('wPerm').textContent = permOk ? 'Klart' : 'Saknas';
  $('wPerm').className = 'chip ' + (permOk ? '' : 'warn');
  $('wPermBtn').classList.toggle('hidden', permOk);
  const show = S.welcomed ? 'home' : 'welcome';
  $('home').classList.toggle('hidden', show !== 'home');
  $('welcome').classList.toggle('hidden', show !== 'welcome');
}

async function testDictation(statusEl) {
  statusEl.textContent = 'Prata nu…';
  await api.test.dictate();
  setTimeout(async () => { await api.test.stop(); statusEl.textContent = 'Texten klistras in där markören står, eller läggs på urklipp.'; }, 3000);
}

$('btnTest').onclick = () => testDictation($('testStatus'));
$('wTest').onclick = () => testDictation($('wTestStatus'));
$('btnMeeting').onclick = () => api.open.meeting();
$('btnUpload').onclick = () => api.open.meeting({ upload: true });
// Inställningar öppnas i samma fönster, med en tillbaka-knapp uppe till vänster.
const toSettings = () => (location.href = '../settings/settings.html?from=home');
$('btnSettings').onclick = toSettings;
$('btnAbout').onclick = () => api.open.about();
$('wPermBtn').onclick = toSettings;
$('wModelsBtn').onclick = toSettings;
$('btnStart').onclick = async () => { await api.settings.set({ welcomed: true }); render(); };

render();
// Håll status aktuell när man kommer tillbaka från Inställningar.
window.addEventListener('focus', render);
