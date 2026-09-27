'use strict';
// Speak. (sub.stnc®): menyradsapp för lokal diktering och mötestranskribering.
const { app, Tray, Menu, nativeImage, ipcMain, dialog, shell, systemPreferences, Notification, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { Settings } = require('./settings');
const { EngineClient } = require('./engine-client');
const { Hotkey, KEY_LABELS, TOGGLE_SHORTCUT } = require('./hotkey');
const { pasteText, accessibilityGranted } = require('./paste');
const windows = require('./windows');
const art = require('./icon-art');
const { WavWriter, convertToWav, concatFloat32, repairWav } = require('../engine/audio');
const { buildMeetingNote } = require('../engine/markdown');

// Appen hette "sub.stnc® - Speak" innan den blev "Speak". Modeller (flera GB) och inställningar ligger kvar
// i den gamla mappen, så den används fortfarande. Ingen flytt: Pianissimos Python-miljö ligger där.
app.setName('Speak.');
app.setPath('userData', path.join(app.getPath('appData'), 'sub.stnc® - Speak'));
// Bara en Speak i taget. Klickar man på appen när den redan kör: väck den som finns i stället.
if (!app.requestSingleInstanceLock()) { app.exit(0); }
app.on('second-instance', () => showCurrent());

// Ännu tidigare hette appen Diktera. Flytta med modeller och inställningar om de ligger kvar under det namnet.
const userData = app.getPath('userData');
try {
  const oldData = path.join(path.dirname(userData), 'Diktera');
  if (!fs.existsSync(userData) && fs.existsSync(oldData)) fs.renameSync(oldData, userData);
} catch (e) { console.error('Kunde inte flytta gamla data:', e.message); }
const settings = new Settings(path.join(userData, 'settings.json'));
const modelsDir = process.env.DIKTERA_MODELS_DIR || path.join(userData, 'models');
const recordingsDir = () => settings.get('recordingsDir') || path.join(userData, 'recordings');
const logsDir = path.join(userData, 'logs');
const engine = new EngineClient(path.join(logsDir, 'engine.log'));
// Huvudprocessens meddelanden sparas i logs/main.log (urklipp, fönster, fel), så att de går att felsöka.
{
  fs.mkdirSync(logsDir, { recursive: true });
  const mainLog = path.join(logsDir, 'main.log');
  try { if (fs.statSync(mainLog).size > 2e6) fs.rmSync(mainLog, { force: true }); } catch {}
  const orig = console.error.bind(console);
  console.error = (...a) => {
    orig(...a);
    try { fs.appendFileSync(mainLog, `${new Date().toISOString()} ${a.map((x) => (x && x.stack) || String(x)).join(' ')}\n`); } catch {}
  };
}
const hotkey = new Hotkey();

let tray = null;
let captureWin = null;
let overlayWin = null;
// Ett enda fönster med två vyer: huvudsidan (där Inställningar också visas) och mötet. Se windows.createMain.
let ui = null;
let quitting = false;
// Mötessidans läge, som sidan själv rapporterar: idle, recording eller processing. Visas på huvudsidan och i menyn.
let meetingState = { state: 'idle' };
let aboutWin = null;

// Tillstånd för ljudinspelning. mode: null | 'dictation' | 'meeting'
const rec = { mode: null, chunks: [], wav: null, wavMic: null, wavSys: null, startedAt: 0, processing: false };

// ---------- Hjälpfunktioner ----------
function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

function engineSettings() {
  const s = settings.get();
  const whisperCli = app.isPackaged ? path.join(process.resourcesPath, 'bin', 'whisper-cli') : path.join(__dirname, '..', '..', 'resources', 'bin', 'whisper-cli');
  return { modelsDir, whisper: s.whisperDictation, liveModel: s.liveModel, ollamaHost: s.ollamaHost, ollamaModel: s.ollamaModel, whisperCli };
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

function viewContents(name) {
  const v = ui && !ui.win.isDestroyed() ? ui.view(name) : null;
  return v && !v.webContents.isDestroyed() ? v.webContents : null;
}
function mainWindow() {
  return ui && !ui.win.isDestroyed() ? ui.win : null;
}
function sendToMeeting(channel, payload) {
  const wc = viewContents('meeting');
  if (wc) wc.send(channel, payload);
}
// Inställningar visas i huvudsidans vy, så nedladdningsförlopp skickas dit.
function sendToSettings(channel, payload) {
  const wc = viewContents('home');
  if (wc) wc.send(channel, payload);
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
  setIconState('live');
  captureSend({ cmd: 'start' });
}

async function stopDictation() {
  if (rec.mode !== 'dictation') return;
  captureSend({ cmd: 'stop' });
  rec.mode = null;
  const samples = concatFloat32(rec.chunks);
  rec.chunks = [];
  if (samples.length < 16000 * 0.4) { setIconState('idle'); return overlay('hidden'); }
  rec.processing = true;
  setIconState('type');
  overlay('processing', 'Transkriberar…');
  try {
    const s = settings.get();
    const policy = settings.policy();
    const r = await engine.call('dictate', { samples, policy, whisper: settings.modelFor('dictation'), useLlm: s.useLlm && s.llmDictation, voiceCommands: s.voiceCommands, vocabulary: s.vocabulary });
    if (!r.text) return overlay('hidden');
    const how = await pasteText(r.text, { autoPaste: s.autoPaste, restoreClipboard: s.restoreClipboard });
    overlay('done', how === 'pasted' ? 'Inklistrat' : 'Kopierat, tryck ⌘V');
    setTimeout(() => overlay('hidden'), 900);
  } catch (e) {
    overlay('error', 'Fel: ' + e.message);
    setTimeout(() => overlay('hidden'), 3500);
    console.error(e);
  } finally {
    rec.processing = false;
    setIconState('idle');
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
  fs.mkdirSync(recordingsDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  rec.wav = new WavWriter(path.join(recordingsDir(), `mote-${stamp}.wav`));
  rec.mode = 'meeting';
  rec.startedAt = Date.now();
  rec.systemAudio = null;
  captureSend({ cmd: 'start', meter: true, systemAudio: mode !== 'mic', mic: mode !== 'system' });
  setIconState('live');
  startLive();
  return rec.wav.filePath;
}

// Livetext: skicka nytt ljud till motorn ungefär varje sekund. Motorn svarar med färdiga talstycken.
function startLive() {
  rec.live = null;
  const model = settings.get('liveModel');
  if (!model) return sendToMeeting('meeting:live-status', { on: false, text: 'Livetext av (välj modell i Inställningar).' });
  // segs: allt som livetexten hunnit ta fram. Används som mötets text när mötet stoppas (om inställt så).
  const live = { chunks: [], busy: false, timer: null, segs: [], ok: false };
  rec.live = live;
  engine.call('liveStart', { model }).then(() => {
    if (rec.live !== live) return;
    live.ok = true;
    sendToMeeting('meeting:live-status', { on: true, text: 'Utkast. Den färdiga texten kommer när du stoppar.' });
    live.timer = setInterval(() => pumpLive(live), 1000);
  }).catch((e) => {
    if (rec.live === live) rec.live = null;
    sendToMeeting('meeting:live-status', { on: false, text: `Livetext av: ${e.message}` });
  });
}

function pumpLive(live) {
  if (live.busy || !live.chunks.length) return;
  const samples = concatFloat32(live.chunks);
  live.chunks = [];
  live.busy = true;
  engine.call('liveFeed', { samples })
    .then((segs) => { if (segs && segs.length) { live.segs.push(...segs); sendToMeeting('meeting:live', segs); } })
    .catch((e) => console.error('livetext:', e.message))
    .finally(() => { live.busy = false; });
}

// Stoppar livetexten och transkriberar det som ligger kvar. Svarar med alla stycken, eller null om
// livetexten inte var igång hela mötet (då görs en vanlig körning i stället).
async function stopLive() {
  const live = rec.live;
  rec.live = null;
  if (!live) return null;
  clearInterval(live.timer);
  if (!live.ok) { engine.call('liveStop').catch(() => {}); return null; }
  try {
    while (live.busy) await new Promise((r) => setTimeout(r, 50));
    if (live.chunks.length) live.segs.push(...(await engine.call('liveFeed', { samples: concatFloat32(live.chunks) })));
    live.chunks = [];
    live.segs.push(...(await engine.call('liveStop')));
    return live.segs;
  } catch (e) {
    console.error('livetext vid stopp:', e.message);
    return null;
  }
}

// Mikrofon och datorns ljud sparas även var för sig (mote-x.mic.wav, mote-x.sys.wav) när båda spelas in.
// Talare bestäms sedan utifrån kanalen: mikrofonen är du, datorns ljud är de andra.
function channelPaths(wavPath) {
  const base = wavPath.replace(/\.wav$/, '');
  return { mic: `${base}.mic.wav`, sys: `${base}.sys.wav` };
}
function writeChannels(mic, sys) {
  if (!rec.wavMic) {
    const c = channelPaths(rec.wav.filePath);
    rec.wavMic = new WavWriter(c.mic);
    rec.wavSys = new WavWriter(c.sys);
    // Kanalerna kom igång efter mixen: fyll ut med tystnad så att tiderna stämmer.
    const lead = new Float32Array(Math.round(rec.wav.seconds * 16000));
    if (lead.length) { rec.wavMic.write(lead); rec.wavSys.write(lead); }
  }
  rec.wavMic.write(mic);
  rec.wavSys.write(sys);
}
// Ligger filen i inspelningsmappen? Filer du själv laddat upp från en annan mapp får aldrig raderas.
function inRecordings(p) {
  const rel = path.relative(path.resolve(recordingsDir()), path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function rmRecording(p) {
  if (!p || !inRecordings(p)) return;
  const c = channelPaths(p);
  for (const f of [p, c.mic, c.sys]) fs.rmSync(f, { force: true });
}

function stopMeetingRecording() {
  if (rec.mode !== 'meeting') return null;
  captureSend({ cmd: 'stop' });
  const liveSegs = stopLive();
  setIconState('idle');
  rec.mode = null;
  const p = rec.wav.finalize();
  const seconds = rec.wav.seconds;
  rec.wav = null;
  if (rec.wavMic) { rec.wavMic.finalize(); rec.wavSys.finalize(); }
  rec.wavMic = null;
  rec.wavSys = null;
  return { wavPath: p, seconds, liveSegs };
}

// Letar efter video som spelats upp under mötet (raderna får aside) och sammanfattar resten.
async function clipsAndSummary(r, s, title) {
  r.segments = await engine.call('findClips', { segments: r.segments, useLlm: s.useLlm, title: title || '' }, (p) => sendToMeeting('meeting:progress', p));
  sendToMeeting('meeting:progress', { phase: 'summarize', text: 'Sammanfattar…' });
  return engine.call('summarize', { segments: r.segments.filter((x) => !x.aside), useLlm: s.useLlm }, (p) => sendToMeeting('meeting:progress', p));
}

// Mötet blev redan transkriberat av livetexten: lägg på talare, städa texten och sammanfatta.
async function meetingFromLive(wavPath, segments, opts = {}) {
  const s = settings.get();
  const c = channelPaths(wavPath);
  const channels = fs.existsSync(c.mic) && fs.existsSync(c.sys) ? c : null;
  setIconState('type');
  try {
    const r = await engine.call('meetingFromLive', { wavPath, segments, diarize: s.diarize, diarizer: s.diarizer, channels, speakerCount: opts.speakerCount || 0, useLlm: s.useLlm, vocabulary: s.vocabulary, title: opts.title || '' },
      (p) => sendToMeeting('meeting:progress', p));
    const summary = await clipsAndSummary(r, s, opts.title);
    return { ...r, summary, wavPath, model: `livetext (${s.liveModel})${r.cleanedBy === 'llm' ? ` + ${s.ollamaModel}` : ''}` };
  } finally {
    setIconState('idle');
  }
}

async function transcribeMeeting(wavPath, opts = {}) {
  const s = settings.get();
  const speakerCount = opts.speakerCount || 0;
  const policy = { ...settings.policy(), ...(opts.language ? { language: opts.language } : {}) };
  sendToMeeting('meeting:progress', { phase: 'load', text: 'Laddar modeller…' });
  const whisper = settings.modelFor('meeting');
  const c = channelPaths(wavPath);
  const channels = fs.existsSync(c.mic) && fs.existsSync(c.sys) ? c : null;
  setIconState('type');
  try {
    const r = await engine.call('meeting', { wavPath, policy, whisper, diarize: s.diarize, diarizer: s.diarizer, channels, speakerCount, vocabulary: s.vocabulary }, (p) => sendToMeeting('meeting:progress', p));
    const summary = await clipsAndSummary(r, s, opts.title);
    return { ...r, summary, wavPath, model: `whisper-${whisper}` };
  } finally {
    setIconState('idle');
  }
}

// ---------- IPC ----------
function registerIpc() {
  // Ljud från det osynliga fönstret.
  ipcMain.on('capture:chunk', (_e, buf, mic, sys) => {
    const f = new Float32Array(buf);
    if (rec.mode === 'dictation') rec.chunks.push(f);
    else if (rec.mode === 'meeting' && rec.wav) {
      if (mic && sys) writeChannels(new Float32Array(mic), new Float32Array(sys));
      rec.wav.write(f);
      if (rec.live) rec.live.chunks.push(f);
    }
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
    if (rec.mode === 'dictation') { rec.mode = null; setIconState('idle'); overlay('error', 'Mikrofonfel'); setTimeout(() => overlay('hidden'), 3000); }
    else if (rec.mode === 'meeting') { stopMeetingRecording(); sendToMeeting('meeting:error', msg); }
  });

  ipcMain.handle('settings:get', () => ({ ...settings.get(), keyLabels: KEY_LABELS, toggleShortcut: TOGGLE_SHORTCUT, modelsDir, recordingsDir: recordingsDir() }));
  ipcMain.handle('settings:set', async (_e, patch) => {
    const before = settings.get();
    const after = settings.set(patch);
    if (patch.hotkey !== undefined || patch.hotkeyMode !== undefined) hotkey.restart({ hotkey: after.hotkey, hotkeyMode: after.hotkeyMode });
    if (patch.launchAtLogin !== undefined) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
    if (patch.showInDock !== undefined && app.dock) (patch.showInDock ? app.dock.show() : app.dock.hide());
    if (patch.whisperDictation !== undefined || patch.whisperMeeting !== undefined || patch.liveModel !== undefined || patch.ollamaModel !== undefined || patch.ollamaHost !== undefined) await engine.call('configure', engineSettings());
    if (before.whisperDictation !== after.whisperDictation) engine.call('warmup').catch(() => {});
    buildTray();
    return after;
  });
  ipcMain.handle('models:status', () => engine.call('status'));
  ipcMain.handle('engine:info', (_e, name) => engine.call('engineInfo', { name }));
  ipcMain.handle('open:logs', () => shell.openPath(logsDir));
  ipcMain.handle('models:install', (_e, { kind, name }) => {
    if (kind === 'nemotron') return engine.call('installNemotron', {}, (p) => sendToSettings('models:progress', { ...p, kind, name }));
    const method = kind === 'whisper' ? 'installWhisper' : 'installAux';
    const params = kind === 'whisper' ? { name } : { key: name };
    return engine.call(method, params, (p) => sendToSettings('models:progress', { ...p, kind, name }));
  });
  ipcMain.handle('models:remove', (_e, { name }) => engine.call(name === 'nemotron' ? 'removeNemotron' : 'removeWhisper', { name }));
  ipcMain.handle('models:import', async () => {
    const r = await dialog.showOpenDialog(mainWindow(), { title: 'Välj modellmapp eller .tar.bz2', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Modell', extensions: ['bz2', 'tar'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const res = await engine.call('importWhisper', { sourcePath: r.filePaths[0] });
    if (!settings.get('whisperMeeting')) settings.set({ whisperMeeting: res.name });
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
  ipcMain.handle('open:meeting', (_e, opts) => openMeeting(opts || {}));
  ipcMain.handle('open:settings', () => openSettings());
  ipcMain.handle('open:about', () => openAbout());
  ipcMain.handle('open:home', () => openHome());
  ipcMain.on('meeting:status', (_e, st) => setMeetingState(st));
  ipcMain.handle('meeting:state', () => meetingState);
  // Stoppa från huvudsidan eller menyn: mötessidan gör det, så att resultatet hamnar där.
  ipcMain.handle('meeting:stop-from-home', () => stopFromOutside());
  ipcMain.handle('app:info', () => ({ version: app.getVersion() }));
  ipcMain.handle('test:dictate', async () => { await startDictation(); });
  ipcMain.handle('test:stop', async () => { await stopDictation(); });

  // Mötesläge
  ipcMain.handle('meeting:start', (_e, opts) => startMeetingRecording(opts || {}));
  ipcMain.handle('meeting:stop', async (_e, opts) => {
    const r = stopMeetingRecording();
    if (!r) throw new Error('Ingen inspelning pågår');
    if (r.seconds < 1) throw new Error('Inspelningen blev för kort');
    // Livetexten används som den är om det är valt och den hann med hela mötet. Annars en ny körning.
    const segs = await r.liveSegs;
    // Livetexten är bara svenska. Har du valt engelska, eller svenska och engelska, för just det här mötet
    // körs hela mötet om med mötesmodellen.
    const lang = opts && opts.language;
    const liveOk = lang !== 'en' && lang !== 'auto';
    if (settings.get('meetingSource') !== 'full' && liveOk && segs && segs.length) return meetingFromLive(r.wavPath, segs, opts || {});
    return transcribeMeeting(r.wavPath, opts || {});
  });
  ipcMain.handle('meeting:cancel', () => {
    const r = stopMeetingRecording();
    if (r && !settings.get('keepRecordings')) rmRecording(r.wavPath);
    return true;
  });
  ipcMain.handle('meeting:upload', async (_e, opts) => {
    const r = await dialog.showOpenDialog(mainWindow(), {
      title: 'Välj ljud- eller videofil',
      properties: ['openFile'],
      filters: [{ name: 'Ljud och video', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'mp4', 'mov', 'aiff', 'caf'] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const input = r.filePaths[0];
    // En egen mötesinspelning (mote-….wav med .mic/.sys bredvid) körs som den är, så att "Jag" och de
    // andra fortfarande skiljs åt via kanalerna. Används för att köra om ett möte som inte blev klart.
    const c = channelPaths(input);
    if (/\/mote-[^/]+\.wav$/.test(input) && !/\.(mic|sys)\.wav$/.test(input) && fs.existsSync(c.mic) && fs.existsSync(c.sys)) {
      // Blev inspelningen avbruten av en krasch saknar filerna rätt storlek i huvudet. Laga dem först.
      for (const f of [input, c.mic, c.sys]) { try { repairWav(f); } catch (e) { console.error('[speak] kunde inte laga', f, e.message); } }
      const result = await transcribeMeeting(input, opts || {});
      return { ...result, sourceFile: input };
    }
    sendToMeeting('meeting:progress', { phase: 'convert', text: 'Konverterar ljudet…' });
    fs.mkdirSync(recordingsDir(), { recursive: true });
    const out = path.join(recordingsDir(), `upload-${Date.now()}.wav`);
    await convertToWav(input, out);
    const result = await transcribeMeeting(out, opts || {});
    return { ...result, sourceFile: input };
  });
  ipcMain.handle('meeting:summarize', (_e, { segments }) => engine.call('summarize', { segments, useLlm: settings.get('useLlm') }));
  ipcMain.handle('settings:choose-recordings', async () => {
    const r = await dialog.showOpenDialog(mainWindow(), { title: 'Mapp för inspelningar', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    settings.set({ recordingsDir: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('meeting:choose-folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow(), { title: 'Välj mapp att spara i', properties: ['openDirectory', 'createDirectory'] });
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
    if (!s.keepRecordings && note.audioPath) rmRecording(note.audioPath);
    return target;
  });
  ipcMain.handle('meeting:discard-audio', (_e, p) => {
    if (p) rmRecording(p);
    return true;
  });
}

// ---------- Fönster och meny ----------
function mainShell() {
  if (!ui || ui.win.isDestroyed()) {
    ui = windows.createMain();
    // Röda knappen gömmer bara fönstret. Inspelning, transkribering och resultat ligger kvar.
    ui.win.on('close', (e) => { if (!quitting) { e.preventDefault(); ui.win.hide(); } });
    ui.win.on('closed', () => { ui = null; });
  }
  return ui;
}

function openMeeting(opts = {}) {
  const sh = mainShell();
  const existed = !!sh.view('meeting');
  sh.meeting(opts);
  // Pågår en inspelning får uppladdningen inte ta över mötet: visa bara mötet.
  if (existed && opts.upload && rec.mode !== 'meeting') sh.view('meeting').webContents.executeJavaScript('upload()').catch(() => {});
  sh.show('meeting');
}

// Inställningar visas i huvudsidans vy, med ← Tillbaka.
function openSettings() {
  const sh = mainShell();
  sh.home().webContents.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'settings.html'), { query: { from: 'home' } });
  sh.show('home');
}

function openHome() {
  const sh = mainShell();
  sh.home();
  sh.show('home');
}

// Mötessidan rapporterar sitt läge. Huvudsidan och menyn visar det.
function setMeetingState(st) {
  const before = meetingState.state;
  meetingState = st || { state: 'idle' };
  const wc = viewContents('home');
  if (wc) wc.send('meeting:state', meetingState);
  if (before !== meetingState.state) buildTray();
}

function openAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) return aboutWin.focus();
  aboutWin = windows.createAbout();
  aboutWin.on('closed', () => (aboutWin = null));
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png'));
  img.setTemplateImage(true);
  return img;
}
function dockIcon() {
  return nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
}

// ---------- Ikonen i rörelse ----------
// Menyradsikonen och Dock-ikonen andas medan du pratar ('live') och "skriver" medan texten tas fram ('type').
// Bildrutorna ritas en gång (src/main/icon-art.js) och byts sedan tio gånger i sekunden.
const anim = { state: 'idle', timer: null, frame: 0, tray: {}, dock: {} };
function trayFrames(state) {
  if (!anim.tray[state]) {
    anim.tray[state] = art.frames(state, { size: 32, tile: false }).map((b) => {
      const img = nativeImage.createFromBuffer(b, { scaleFactor: 2 });
      img.setTemplateImage(true);
      return img;
    });
  }
  return anim.tray[state];
}
// Dock-bilderna är större och tar någon sekund att rita. De ritas en i taget i bakgrunden efter start.
function warmDockFrames() {
  const jobs = [];
  for (const state of ['live', 'type']) {
    const n = Math.round(art.PERIOD[state] * 10);
    const list = [];
    for (let i = 0; i < n; i++) jobs.push(() => list.push(nativeImage.createFromBuffer(art.render({ size: 256, state, t: i / 10 }))));
    jobs.push(() => (anim.dock[state] = list));
  }
  const next = () => { const job = jobs.shift(); if (job) { job(); setTimeout(next, 30); } };
  setTimeout(next, 3000);
}
function setIconState(state) {
  if (anim.state === state) return;
  anim.state = state;
  clearInterval(anim.timer);
  anim.timer = null;
  const dockOn = process.platform === 'darwin' && app.dock && settings.get('showInDock');
  if (state === 'idle') {
    if (tray) tray.setImage(trayIcon());
    if (dockOn) app.dock.setIcon(dockIcon());
    return;
  }
  const t = trayFrames(state);
  anim.frame = 0;
  anim.timer = setInterval(() => {
    const i = anim.frame++;
    if (tray) tray.setImage(t[i % t.length]);
    const d = anim.dock[state];
    if (dockOn && d) app.dock.setIcon(d[i % d.length]);
  }, 100);
}

function stopFromOutside() {
  openMeeting();
  const wc = viewContents('meeting');
  if (wc) wc.executeJavaScript("document.getElementById('btnStop').click()").catch(() => {});
}

function buildTray() {
  if (!tray) {
    try {
      tray = new Tray(trayIcon());
      tray.setToolTip('Speak.');
    } catch (e) {
      console.error('Kunde inte skapa menyradsikon:', e.message);
      return;
    }
  }
  const s = settings.get();
  const keyLabel = KEY_LABELS[s.hotkey] || s.hotkey;
  const key = (keyLabel.match(/[⌃⌥⌘⇧]/) || [keyLabel])[0];
  // Modeller och Ollama visas i huvudfönstret. Genvägen ⌥⇧D fungerar fortfarande, men syns inte här.
  const menu = Menu.buildFromTemplate([
    { label: 'Öppna Speak', click: showCurrent },
    { type: 'separator' },
    { label: s.hotkeyMode === 'hold' ? `Diktera: håll in ${key}` : `Diktera: tryck ${key}`, enabled: false },
    ...(meetingState.state === 'recording' ? [
      { label: '● Möte spelas in', enabled: false },
      { label: 'Visa mötet', click: () => openMeeting() },
      { label: 'Stoppa och transkribera', click: stopFromOutside },
    ] : meetingState.state === 'processing' ? [
      { label: 'Möte transkriberas…', enabled: false },
      { label: 'Visa mötet', click: () => openMeeting() },
    ] : [
      { label: 'Nytt möte…', click: () => openMeeting() },
    ]),
    { type: 'separator' },
    { label: 'Inställningar…', accelerator: 'Command+,', click: openSettings },
    { label: 'Om Speak', click: openAbout },
    { type: 'separator' },
    { label: 'Avsluta Speak', accelerator: 'Command+Q', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

// Rester i inspelningsmappen (krasch, avslutat mitt i) städas vid start om inspelningar inte ska behållas.
function cleanRecordings() {
  const dir = recordingsDir();
  if (settings.get('keepRecordings') || !fs.existsSync(dir)) return;
  const old = Date.now() - 24 * 3600 * 1000;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { if (/^(mote-|upload-).*\.wav$/.test(f) && fs.statSync(p).mtimeMs < old) fs.rmSync(p, { force: true }); } catch {}
  }
}

async function firstRunCheck() {
  const st = await engine.call('status');
  const s = settings.get();
  const d = settings.modelFor('dictation');
  const missing = !st.whisper[d] || !st.whisper[d].installed || !st.aux.vad.installed;
  // Huvudfönstret öppnas vid start, men inte när appen startar i bakgrunden vid inloggning.
  const atLogin = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
  if (!s.welcomed || !atLogin) openHome();
  if (missing) {
    if (s.welcomed) openSettings();
    notify('Speak behöver modeller', 'Importera KB-Whisper eller ladda ner turbo i Inställningar, och hämta talarmodellerna.');
  } else {
    engine.call('warmup').catch((e) => console.error('warmup', e.message));
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock && !settings.get('showInDock')) app.dock.hide();

  // Bara vårt eget osynliga fönster får mikrofonen. Inga andra behörigheter beviljas.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' && captureWin && wc.id === captureWin.webContents.id);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media' && !!captureWin && !!wc && wc.id === captureWin.webContents.id);

  registerIpc();
  // Ikonen först, så att appen alltid syns även om motorn strular.
  buildTray();
  try {
    await engine.start();
    await engine.call('init', engineSettings());
    await ensureLlmModel();
  } catch (e) {
    console.error('Motorn kunde inte starta:', e.message);
    dialog.showErrorBox('Speak: motorn kunde inte starta', `${e.message}\n\nLoggar: ${logsDir}`);
  }

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
  if (process.env.DIKTERA_SMOKE) return require('./smoke')({ engine, openMeeting, openSettings, transcribeMeeting, startDictation, stopDictation, wins: () => {
    const v = (n) => { const wc = viewContents(n); return wc ? { webContents: wc, isDestroyed: () => wc.isDestroyed() } : null; };
    return { meetingWin: v('meeting'), settingsWin: v('home'), captureWin, overlayWin };
  } });
  cleanRecordings();
  warmDockFrames();
  await firstRunCheck();

  engine.on('exit', () => {
    notify('Speak', 'Transkriberingsmotorn startade om.');
    engine.start().then(() => engine.call('init', engineSettings())).catch(console.error);
  });
});

app.on('window-all-closed', () => { /* menyradsapp: fortsätt köra */ });
// Klick på Dock-ikonen eller "Öppna Speak": fönstret visas där du var senast. Spelas ett möte in visas mötet.
function showCurrent() {
  if (rec.mode === 'meeting') return openMeeting();
  const sh = mainShell();
  sh.home();
  sh.show(sh.current && sh.view(sh.current) ? sh.current : 'home');
}
app.on('activate', () => { if (app.isReady()) showCurrent(); });
app.on('before-quit', (e) => {
  // Avsluta mitt i ett möte: fråga först, så att inspelningen inte försvinner av misstag.
  if (!quitting && meetingState.state !== 'idle') {
    const r = dialog.showMessageBoxSync({ type: 'warning', buttons: ['Avbryt', 'Avsluta ändå'], defaultId: 0, cancelId: 0,
      message: { recording: 'Ett möte spelas in.', processing: 'Ett möte transkriberas.', done: 'Mötet är inte sparat.' }[meetingState.state] || 'Ett möte pågår.',
      detail: meetingState.state === 'done' ? 'Avslutar du nu försvinner texten.' : 'Avslutar du nu blir mötet inte klart.' });
    if (r === 0) return e.preventDefault();
  }
  quitting = true;
  hotkey.stop();
  engine.stop();
});
