'use strict';
// Lägger texten på urklipp och simulerar ⌘V i det program som har fokus.
const { clipboard, ClipboardItem, systemPreferences } = require('electron');
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

// Urklipp i Electron 44 är asynkront: readText(), read() och write() svarar med ett löfte som måste väntas in.
// (Förut jämfördes löftet med texten, så det kopierade lades aldrig tillbaka.)
//
// Sparar allt som ligger på urklipp, inte bara text: formatering, bild och filer från Finder.
async function snapshotClipboard() {
  try {
    const items = await clipboard.read();
    const saved = [];
    for (const item of items) {
      const entry = {};
      for (const type of item.types) {
        try { entry[type] = await item.getType(type); } catch { /* typen gick inte att läsa */ }
      }
      if (Object.keys(entry).length) saved.push(entry);
    }
    if (saved.length || !items.length) return { items: saved, text: null };
  } catch (e) {
    console.error('[urklipp] kunde inte läsa allt, sparar bara texten:', e.message);
  }
  // Reserv: bara texten.
  try { return { items: null, text: await clipboard.readText() }; } catch { return { items: null, text: '' }; }
}

async function restoreSnapshot(snap) {
  if (snap.items) {
    if (!snap.items.length) return clipboard.clear();
    return clipboard.write(snap.items.map((entry) => new ClipboardItem(entry)));
  }
  if (snap.text) return clipboard.writeText(snap.text);
  return clipboard.clear();
}

function describe(snap) {
  if (snap.items) return snap.items.length ? snap.items.map((e) => Object.keys(e).join('+')).join(', ') : 'tomt';
  return snap.text ? `${snap.text.length} tecken text` : 'tomt';
}

// Returnerar 'pasted' eller 'clipboard' (texten ligger bara på urklipp).
async function pasteText(text, { autoPaste = true, restoreClipboard = true } = {}) {
  if (!autoPaste || process.platform !== 'darwin' || !accessibilityGranted(false)) {
    await clipboard.writeText(text);
    return 'clipboard';
  }
  const previous = restoreClipboard ? await snapshotClipboard() : null;
  await clipboard.writeText(text);
  try {
    await sleep(60);
    await sendCmdV();
  } catch (e) {
    console.error('Inklistring misslyckades:', e.message);
    return 'clipboard';
  }
  if (previous) {
    // Vissa program läser urklipp en stund efter ⌘V. Vänta, och skriv tillbaka bara om ingen annan
    // hunnit ändra urklippet under tiden.
    await sleep(700);
    try {
      const now = await clipboard.readText();
      if (now === text) await restoreSnapshot(previous);
      // Felsökning: syns i logs/main.log. Inga texter loggas, bara vilka sorter som fanns.
      console.error(`[urklipp] före: ${describe(previous)}, efter ⌘V: ${now === text ? 'dikteringen, lägger tillbaka' : 'annat, rör inte'}`);
    } catch (e) {
      console.error('[urklipp] kunde inte lägga tillbaka:', e.message);
    }
  }
  return 'pasted';
}

module.exports = { pasteText, accessibilityGranted };
