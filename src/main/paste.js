'use strict';
// Lägger texten på urklipp och simulerar ⌘V i det program som har fokus.
const { clipboard, systemPreferences } = require('electron');
const { execFile } = require('child_process');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendCmdV() {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], (err, _out, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

function accessibilityGranted(prompt = false) {
  return process.platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(prompt) : true;
}

// Sparar allt som ligger på urklipp, inte bara text: bild, formaterad text och filer från Finder.
// Annars försvinner det du hade kopierat när dikteringen klistras in.
const FILE_TYPES = ['public.file-url', 'NSFilenamesPboardType'];
function snapshotClipboard() {
  const formats = clipboard.availableFormats();
  const snap = {};
  const text = clipboard.readText();
  if (text) snap.text = text;
  if (formats.includes('text/html')) snap.html = clipboard.readHTML();
  if (formats.includes('text/rtf')) snap.rtf = clipboard.readRTF();
  if (formats.some((f) => f.startsWith('image/'))) {
    const img = clipboard.readImage();
    if (!img.isEmpty()) snap.image = img;
  }
  const files = [];
  for (const t of FILE_TYPES) {
    try {
      const b = clipboard.readBuffer(t);
      if (b && b.length) files.push([t, b]);
    } catch { /* formatet finns inte */ }
  }
  return { snap, files, empty: !formats.length };
}

function restoreSnapshot({ snap, files, empty }) {
  if (empty) return clipboard.clear();
  // En kopierad fil från Finder läggs tillbaka som fil (den har också filnamnet som text, som då får stå tillbaka).
  if (files.length) return clipboard.writeBuffer(files[0][0], files[0][1]);
  clipboard.write(snap);
}

// Returnerar 'pasted' eller 'clipboard' (texten ligger bara på urklipp).
async function pasteText(text, { autoPaste = true, restoreClipboard = true } = {}) {
  if (!autoPaste || process.platform !== 'darwin' || !accessibilityGranted(false)) {
    clipboard.writeText(text);
    return 'clipboard';
  }
  const previous = restoreClipboard ? snapshotClipboard() : null;
  clipboard.writeText(text);
  try {
    await sleep(60);
    await sendCmdV();
    if (previous) {
      // Vissa program läser urklipp en stund efter ⌘V. Vänta, och skriv tillbaka bara om ingen annan
      // hunnit ändra urklippet under tiden.
      await sleep(700);
      const now = clipboard.readText();
      if (now === text) restoreSnapshot(previous);
      // Felsökning: syns i loggen om urklipp inte kom tillbaka (inga texter loggas, bara längder).
      console.error(`[urklipp] före: ${previous.empty ? 'tomt' : `${(previous.snap.text || '').length} tecken text${previous.files.length ? ' + fil' : ''}${previous.snap.image ? ' + bild' : ''}`}, `
        + `efter ⌘V: ${now === text ? 'dikteringen, lägger tillbaka' : `annat (${now.length} tecken), rör inte`}`);
    }
    return 'pasted';
  } catch (e) {
    console.error('Inklistring misslyckades:', e.message);
    clipboard.writeText(text);
    return 'clipboard';
  }
}

module.exports = { pasteText, accessibilityGranted };
