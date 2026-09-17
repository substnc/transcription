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

// Returnerar 'pasted' eller 'clipboard' (texten ligger bara på urklipp).
async function pasteText(text, { autoPaste = true, restoreClipboard = true } = {}) {
  const previous = restoreClipboard ? clipboard.readText() : null;
  clipboard.writeText(text);
  if (!autoPaste || process.platform !== 'darwin' || !accessibilityGranted(false)) return 'clipboard';
  try {
    await sleep(60);
    await sendCmdV();
    if (restoreClipboard) {
      await sleep(400);
      // Skriv tillbaka bara om ingen annan hunnit ändra urklippet.
      if (clipboard.readText() === text) clipboard.writeText(previous || '');
    }
    return 'pasted';
  } catch (e) {
    console.error('Inklistring misslyckades:', e.message);
    clipboard.writeText(text);
    return 'clipboard';
  }
}

module.exports = { pasteText, accessibilityGranted };
