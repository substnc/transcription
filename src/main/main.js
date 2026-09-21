'use strict';
// sub.stnc® - Speak: menyradsapp för lokal diktering och mötestranskribering.
const { app, Tray, Menu, nativeImage, ipcMain, dialog, shell, systemPreferences, Notification, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { Settings } = require('./settings');
const { EngineClient } = require('./engine-client');
const { Hotkey, KEY_LABELS, TOGGLE_SHORTCUT } = require('./hotkey');
const { pasteText, accessibilityGranted } = require('./paste');
const windows = require('./windows');
const { WavWriter, convertToWav, concatFloat32 } = require('../engine/audio');
const { buildMeetingNote } = require('../engine/markdown');
const { WHISPER_MODELS } = require('../engine/models');

if (!app.requestSingleInstanceLock()) app.quit();

// Appen hette Diktera tidigare. Flytta med modeller och inställningar om de ligger kvar under det gamla namnet.
const userData = app.getPath('userData');
try {
  const oldData = path.join(path.dirname(userData), 'Diktera');
  if (!fs.existsSync(userData) && fs.existsSync(oldData)) fs.renameSync(oldData, userData);
} catch (e) { console.error('Kunde inte flytta gamla data:', e.message); }
const settings = new Settings(path.join(userData, 'settings.json'));
const modelsDir = process.env.DIKTERA_MODELS_DIR || path.join(userData, 'models');
const recordingsDir = path.join(userData, 'recordings');
const logsDir = path.join(userData, 'logs');
const engine = new EngineClient(path.join(logsDir, 'engine.log'));
const hotkey = new Hotkey();

let tray = null;
let captureWin = null;
let overlayWin = null;
let meetingWin = null;
let settingsWin = null;

// Tillstånd för ljudinspelning. mode: null | 'dictation' | 'meeting'
const rec = { mode: null, chunks: [], wav: null, startedAt: 0, processing: false };

// ---------- Hjälpfunktioner ----------
function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

function engineSettings() {
  const s = settings.get();
  const whisperCli = app.isPackaged ? path.join(process.resourcesPath, 'bin', 'whisper-cli') : path.join(__dirname, '..', '..', 'resources', 'bin', 'whisper-cli');
  return { modelsDir, whisper: s.whisper, ollamaHost: s.ollamaHost, ollamaModel: s.ollamaModel, whisperCli };
}

async function ensureLlmModel() {
  // Väljer automatiskt en installerad Ollama-modell om ingen är vald.
  const s = settings.get();
  if (s.ollamaModel || !s.useLlm) return;
  try {
    const st = await engine.call('llmStatus');
    if (st.ok && st.models.length) {
      const prefer = st.models.find((m) => /qwen|gemma|llama|mistral/i.test(m)) || st.models[0];
      settings.set({ ollamaModel: prefer });
      await engine.call('configure', { ollamaModel: prefer });
    }
  } catch { /* Ollama saknas, reglerna används */ }
}

function overlay(state, text) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.webContents.send('overlay:state', { state, text });
  if (state === 'hidden') overlayWin.hide();
  else {
    windows.positionOverlay(overlayWin);
    overlayWin.showInactive();
  }
}

function sendToMeeting(channel, payload) {
  if (meetingWin && !meetingWin.isDestroyed()) meetingWin.webContents.send(channel, payload);
}
function sendToSettings(channel, payload) {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, payload);
}

function captureSend(msg) {
  if (captureWin && !captureWin.isDestroyed()) captureWin.webContents.send('capture:command', msg);
}

// ---------- Diktering ----------
async function startDictation() {
  if (rec.mode || rec.processing) return;
  rec.mode = 'dictation';
  rec.chunks = [];
  rec.startedAt = Date.now();
  overlay('listening', 'Lyssnar…');
  captureSend({ cmd: 'start' });
}

async function stopDictation() {
  if (rec.mode !== 'dictation') return;
  captureSend({ cmd: 'stop' });
  rec.mode = null;
  const samples = concatFloat32(rec.chunks);
  rec.chunks = [];
  if (samples.length < 16000 * 0.4) return overlay('hidden');
  rec.processing = true;
  overlay('processing', 'Bearbetar…');
  try {
    const s = settings.get();
    const r = await engine.call('dictate', { samples, policy: settings.policy(), useLlm: s.useLlm && s.llmDictation, voiceCommands: s.voiceCommands });
    if (!r.text) return overlay('hidden');
    const how = await pasteText(r.text, { autoPaste: s.autoPaste, restoreClipboard: s.restoreClipboard });
    overlay('done', how === 'pasted' ? 'Inklistrat' : 'Kopierat till urklipp');
    setTimeout(() => overlay('hidden'), 900);
  } catch (e) {
    overlay('error', 'Fel: ' + e.message);
    setTimeout(() => overlay('hidden'), 3500);
    console.error(e);
  } finally {
    rec.processing = false;
  }
}

function toggleDictation() {
  if (rec.mode === 'dictation') stopDictation();
  else startDictation();
}

// ---------- Möte ----------
function startMeetingRecording(opts = {}) {
  if (rec.mode) throw new Error('Inspelning pågår redan');
  const mode = opts.sourceMode || (settings.get('captureSystemAudio') ? 'both' : 'mic');
  fs.mkdirSync(recordingsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  rec.wav = new WavWriter(path.join(recordingsDir, `mote-${stamp}.wav`));
  rec.mode = 'meeting';
  rec.startedAt = Date.now();
  rec.systemAudio = null;
  captureSend({ cmd: 'start', meter: true, systemAudio: mode !== 'mic', mic: mode !== 'system' });
  return rec.wav.filePath;
}

function stopMeetingRecording() {
  if (rec.mode !== 'meeting') return null;
  captureSend({ cmd: 'stop' });
  rec.mode = null;
  const p = rec.wav.finalize();
  const seconds = rec.wav.seconds;
  rec.wav = null;
  return { wavPath: p, seconds };
}

async function transcribeMeeting(wavPath, opts = {}) {
  const s = settings.get();
  const speakerCount = opts.speakerCount || 0;
  const policy = { ...settings.policy(), ...(opts.language ? { language: opts.language } : {}) };
  sendToMeeting('meeting:progress', { phase: 'load', text: 'Laddar modeller…' });
  const r = await engine.call('meeting', { wavPath, policy, diarize: s.diarize, speakerCount }, (p) => sendToMeeting('meeting:progress', p));
  sendToMeeting('meeting:progress', { phase: 'summarize', text: 'Sammanfattar…' });
  const summary = await engine.call('summarize', { segments: r.segments, useLlm: s.useLlm });
  return { ...r, summary, wavPath, model: `whisper-${s.whisper}` };
}

// ---------- IPC ----------
function registerIpc() {
  // Ljud från det osynliga fönstret.
  ipcMain.on('capture:chunk', (_e, buf) => {
    const f = new Float32Array(buf);
    if (rec.mode === 'dictation') rec.chunks.push(f);
    else if (rec.mode === 'meeting' && rec.wav) rec.wav.write(f);
  });
  ipcMain.on('capture:level', (_e, level) => sendToMeeting('meeting:level', { level, seconds: rec.wav ? rec.wav.seconds : 0 }));
  // Vilka källor inspelningen faktiskt fick: mikrofon och/eller datorns ljud.
  ipcMain.on('capture:info', (_e, info) => { rec.systemAudio = info.systemAudio; sendToMeeting('meeting:info', info); });
  // Skärmkälla för systemljud (macOS 14.2+ via ScreenCaptureKit). Kräver skärminspelningsbehörighet.
  ipcMain.handle('capture:screen-source', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      return sources.length ? sources[0].id : null;
    } catch (e) {
      console.error('desktopCapturer:', e.message);
      return null;
    }
  });
  ipcMain.on('capture:error', (_e, msg) => {
    console.error('Mikrofonfel:', msg);
    if (rec.mode === 'dictation') { rec.mode = null; overlay('error', 'Mikrofonfel'); setTimeout(() => overlay('hidden'), 3000); }
    else if (rec.mode === 'meeting') { stopMeetingRecording(); sendToMeeting('meeting:error', msg); }
  });

  ipcMain.handle('settings:get', () => ({ ...settings.get(), keyLabels: KEY_LABELS, toggleShortcut: TOGGLE_SHORTCUT, whisperModels: WHISPER_MODELS, modelsDir, recordingsDir }));
  ipcMain.handle('settings:set', async (_e, patch) => {
    const before = settings.get();
    const after = settings.set(patch);
    if (patch.hotkey !== undefined || patch.hotkeyMode !== undefined) hotkey.restart({ hotkey: after.hotkey, hotkeyMode: after.hotkeyMode });
    if (patch.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
    if (patch.whisper !== undefined || patch.ollamaModel !== undefined || patch.ollamaHost !== undefined) await engine.call('configure', engineSettings());
    if (before.whisper !== after.whisper) engine.call('warmup').catch(() => {});
    buildTray();
    return after;
  });
  ipcMain.handle('models:status', () => engine.call('status'));
  ipcMain.handle('engine:info', () => engine.call('engineInfo'));
  ipcMain.handle('open:logs', () => shell.openPath(logsDir));
  ipcMain.handle('models:install', (_e, { kind, name }) => {
    const method = kind === 'whisper' ? 'installWhisper' : 'installAux';
    const params = kind === 'whisper' ? { name } : { key: name };
    return engine.call(method, params, (p) => sendToSettings('models:progress', { kind, name, ...p }));
  });
  ipcMain.handle('models:remove', (_e, { name }) => engine.call('removeWhisper', { name }));
  ipcMain.handle('models:import', async () => {
    const r = await dialog.showOpenDialog(settingsWin, { title: 'Välj modellmapp eller .tar.bz2', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Modell', extensions: ['bz2', 'tar'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const res = await engine.call('importWhisper', { sourcePath: r.filePaths[0] });
    settings.set({ whisper: res.name });
    await engine.call('configure', engineSettings());
    buildTray();
    return res;
  });
  ipcMain.handle('llm:status', () => engine.call('llmStatus'));
  ipcMain.handle('perm:status', () => ({
    accessibility: accessibilityGranted(false),
    microphone: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted',
    screen: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
    hotkeyActive: hotkey.active,
    hotkeyError: hotkey.error,
  }));
  ipcMain.handle('perm:request', async (_e, what) => {
    if (what === 'microphone') return systemPreferences.askForMediaAccess('microphone');
    if (what === 'accessibility') return accessibilityGranted(true);
    return false;
  });
  ipcMain.handle('open:external', (_e, url) => {
    // Bara systeminställningar och lokala sökvägar. Aldrig godtyckliga webbadresser.
    if (typeof url === 'string' && url.startsWith('x-apple.systempreferences:')) return shell.openExternal(url);
    return false;
  });
  ipcMain.handle('open:path', (_e, p) => shell.openPath(p));
  ipcMain.handle('open:folder', (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle('open:meeting', () => openMeeting());
  ipcMain.handle('test:dictate', async () => { await startDictation(); });
  ipcMain.handle('test:stop', async () => { await stopDictation(); });

  // Mötesläge
  ipcMain.handle('meeting:start', (_e, opts) => startMeetingRecording(opts || {}));
  ipcMain.handle('meeting:stop', async (_e, opts) => {
    const r = stopMeetingRecording();
    if (!r) throw new Error('Ingen inspelning pågår');
    if (r.seconds < 1) throw new Error('Inspelningen blev för kort');
    return transcribeMeeting(r.wavPath, opts || {});
  });
  ipcMain.handle('meeting:cancel', () => {
    const r = stopMeetingRecording();
    if (r && !settings.get('keepRecordings')) fs.rmSync(r.wavPath, { force: true });
    return true;
  });
  ipcMain.handle('meeting:upload', async (_e, opts) => {
    const r = await dialog.showOpenDialog(meetingWin, {
      title: 'Välj ljud- eller videofil',
      properties: ['openFile'],
      filters: [{ name: 'Ljud och video', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'mp4', 'mov', 'aiff', 'caf'] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const input = r.filePaths[0];
    sendToMeeting('meeting:progress', { phase: 'convert', text: 'Konverterar ljudet…' });
    fs.mkdirSync(recordingsDir, { recursive: true });
    const out = path.join(recordingsDir, `upload-${Date.now()}.wav`);
    await convertToWav(input, out);
    const result = await transcribeMeeting(out, opts || {});
    return { ...result, sourceFile: input };
  });
  ipcMain.handle('meeting:summarize', (_e, { segments }) => engine.call('summarize', { segments, useLlm: settings.get('useLlm') }));
  ipcMain.handle('meeting:choose-folder', async () => {
    const r = await dialog.showOpenDialog(meetingWin, { title: 'Välj mapp att spara i', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('meeting:save', async (_e, { note, folder }) => {
    if (!folder) throw new Error('Ingen mapp vald');
    const s = settings.get();
    const built = buildMeetingNote({ ...note, date: note.date ? new Date(note.date) : new Date(), audioPath: s.keepRecordings ? note.audioPath : undefined });
    fs.mkdirSync(folder, { recursive: true });
    let target = path.join(folder, built.filename);
    let i = 2;
    while (fs.existsSync(target)) target = path.join(folder, built.filename.replace(/\.md$/, ` (${i++}).md`));
    fs.writeFileSync(target, built.content, 'utf8');
    if (!s.keepRecordings && note.audioPath) fs.rmSync(note.audioPath, { force: true });
    return target;
  });
  ipcMain.handle('meeting:discard-audio', (_e, p) => {
    if (p && p.startsWith(recordingsDir)) fs.rmSync(p, { force: true });
    return true;
  });
}

// ---------- Fönster och meny ----------
function openMeeting() {
  if (meetingWin && !meetingWin.isDestroyed()) return meetingWin.focus();
  meetingWin = windows.createMeeting();
  meetingWin.on('closed', () => {
    meetingWin = null;
    if (rec.mode === 'meeting') stopMeetingRecording();
  });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = windows.createSettings();
  settingsWin.on('closed', () => (settingsWin = null));
}

function trayIcon() {
  const p = path.join(__dirname, '..', '..', 'assets', 'micTemplate.png');
  const img = nativeImage.createFromPath(p);
  img.setTemplateImage(true);
  return img;
}

function buildTray() {
  if (!tray) {
    try {
      tray = new Tray(trayIcon());
      tray.setToolTip('sub.stnc® - Speak');
    } catch (e) {
      console.error('Kunde inte skapa menyradsikon:', e.message);
      return;
    }
  }
  const s = settings.get();
  const keyLabel = KEY_LABELS[s.hotkey] || s.hotkey;
  const menu = Menu.buildFromTemplate([
    { label: s.hotkeyMode === 'hold' ? `Diktera: håll in ${keyLabel}` : `Diktera: tryck ${keyLabel} (av/på)`, enabled: false },
    { label: `Växla diktering: ${TOGGLE_SHORTCUT.replace('Alt', '⌥').replace('Shift', '⇧').replace(/\+/g, '')}`, click: toggleDictation },
    { type: 'separator' },
    { label: 'Mötesläge…', click: openMeeting },
    { label: 'Inställningar och modeller…', click: openSettings },
    { type: 'separator' },
    { label: `Modell: whisper-${s.whisper}`, enabled: false },
    { label: `Allt körs lokalt${s.useLlm && s.ollamaModel ? ` · Ollama: ${s.ollamaModel}` : ''}`, enabled: false },
    { type: 'separator' },
    { label: 'Avsluta Speak', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

async function firstRunCheck() {
  const st = await engine.call('status');
  const s = settings.get();
  if (!st.whisper[s.whisper] || !st.whisper[s.whisper].installed || !st.aux.vad.installed) {
    openSettings();
    notify('Speak behöver modeller', 'Importera KB-Whisper eller ladda ner turbo i Inställningar, och hämta talarmodellerna.');
  } else {
    engine.call('warmup').catch((e) => console.error('warmup', e.message));
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  // Bara vårt eget osynliga fönster får mikrofonen. Inga andra behörigheter beviljas.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' && captureWin && wc.id === captureWin.webContents.id);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' && !!captureWin && !!wc && wc.id === captureWin.webContents.id);

  registerIpc();
  await engine.start();
  await engine.call('init', engineSettings());
  await ensureLlmModel();

  captureWin = windows.createCapture();
  captureWin.webContents.on('render-process-gone', () => { captureWin = windows.createCapture(); });
  overlayWin = windows.createOverlay();

  hotkey.configure({ hotkey: settings.get('hotkey'), hotkeyMode: settings.get('hotkeyMode') });
  hotkey.on('press', startDictation);
  hotkey.on('release', stopDictation);
  hotkey.on('toggle', toggleDictation);
  if (!hotkey.start()) console.error('Håll-in-tangent kunde inte aktiveras:', hotkey.error);

  buildTray();
  if (process.platform === 'darwin') systemPreferences.askForMediaAccess('microphone').catch(() => {});
  if (process.env.DIKTERA_SMOKE) return require('./smoke')({ engine, openMeeting, openSettings, transcribeMeeting, startDictation, stopDictation, wins: () => ({ meetingWin, settingsWin, captureWin, overlayWin }) });
  await firstRunCheck();

  engine.on('exit', () => {
    notify('Speak', 'Transkriberingsmotorn startade om.');
    engine.start().then(() => engine.call('init', engineSettings())).catch(console.error);
  });
});

app.on('window-all-closed', () => { /* menyradsapp: fortsätt köra */ });
app.on('before-quit', () => {
  hotkey.stop();
  engine.stop();
});
