'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ICLOUD_OBSIDIAN = path.join(os.homedir(), 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents');

const DEFAULTS = {
  hotkey: 'AltRight', // håll in höger ⌥ för att diktera
  hotkeyMode: 'hold', // 'hold' eller 'toggle'
  whisperSv: 'kb-large-metal', // modell för svenska och blandat tal
  whisperEn: 'turbo-metal', // modell för helt engelska
  language: 'auto', // 'auto' | 'sv' | 'en'
  allowed: ['sv', 'en'],
  primary: 'sv',
  useLlm: true,
  llmDictation: true, // språkmodell även vid diktering (långsammare men bättre städning)
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaModel: '',
  voiceCommands: true,
  autoPaste: true,
  restoreClipboard: true,
  keepRecordings: true,
  diarize: true,
  captureSystemAudio: true, // ta med datorns ljud (videomöten) i mötesinspelningar
  vocabulary: '', // ordlista: namn och facktermer, ett per rad, skickas som prompt till whisper
  inboxes: [
    { label: '01_CLAUDE_COWORK / 99_inbox', path: path.join(ICLOUD_OBSIDIAN, '01_CLAUDE_COWORK', '99_inbox') },
    { label: '02_CLAUDE_PRIVATE / 99_inbox', path: path.join(ICLOUD_OBSIDIAN, '02_CLAUDE_PRIVATE', '99_inbox') },
  ],
  defaultInbox: 0,
  launchAtLogin: false,
};

class Settings {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        // Äldre inställningar hade en enda modell ("whisper"). Den blir svenskmodellen.
        if (saved.whisper && !saved.whisperSv) saved.whisperSv = saved.whisper;
        delete saved.whisper;
        this.data = { ...DEFAULTS, ...saved };
      }
    } catch (e) {
      console.error('Kunde inte läsa inställningar:', e.message);
    }
  }
  get(key) {
    return key ? this.data[key] : { ...this.data };
  }
  set(patch) {
    this.data = { ...this.data, ...patch };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
  // Språket avgör modellen: engelska får sin egen, allt annat (svenska, blandat) får svenskmodellen.
  modelFor(language) {
    return language === 'en' ? this.data.whisperEn || this.data.whisperSv : this.data.whisperSv;
  }
  policy() {
    return { language: this.data.language, allowed: this.data.allowed, primary: this.data.primary };
  }
}

module.exports = { Settings, DEFAULTS, ICLOUD_OBSIDIAN };
