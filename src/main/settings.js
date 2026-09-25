'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ICLOUD_OBSIDIAN = path.join(os.homedir(), 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents');
// Inspelningar sparas som standard lokalt (Application Support/…/recordings), aldrig i iCloud, så att ljud
// inte hamnar i ett moln för den som installerar appen. Anthons val (iCloud Drive/01_CLAUDE_CODE) ligger kvar i
// hans sparade inställningar. Kan ändras i Inställningar.
const DEFAULT_RECORDINGS = '';

const DEFAULTS = {
  hotkey: 'AltRight', // håll in höger ⌥ för att diktera
  hotkeyMode: 'hold', // 'hold' eller 'toggle'
  whisperDictation: 'turbo-metal', // snabb modell för diktering
  whisperMeeting: 'kb-large-metal', // noggrann modell för möten
  liveModel: 'pianissimo-sv', // livetext under inspelning ('' = av)
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
  recordingsDir: DEFAULT_RECORDINGS,
  keepRecordings: false, // ljudfilen tas bort när anteckningen är sparad eller mötet kastas
  diarize: true,
  diarizer: 'nemotron', // 'nemotron' (NVIDIA Nemotron 3, när den är installerad, max 8 talare) eller 'standard'
  meetingSource: 'live', // 'live': livetexten blir mötets text (snabbt). 'full': hela mötet körs om med modellen för möten.
  captureSystemAudio: true, // ta med datorns ljud (videomöten) i mötesinspelningar
  vocabulary: '', // ordlista: namn och facktermer, ett per rad, skickas som prompt till whisper
  inboxes: [
    { label: '01_CLAUDE_COWORK / 99_inbox', path: path.join(ICLOUD_OBSIDIAN, '01_CLAUDE_COWORK', '99_inbox') },
    { label: '02_CLAUDE_PRIVATE / 99_inbox', path: path.join(ICLOUD_OBSIDIAN, '02_CLAUDE_PRIVATE', '99_inbox') },
  ],
  defaultInbox: 0,
  launchAtLogin: false,
  showInDock: true, // ikon i Dock så att man ser att appen kör
  welcomed: false, // välkomstsidan i huvudfönstret har visats och klickats bort
};

class Settings {
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS };
    try {
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        // Äldre inställningar: en enda modell ("whisper") eller per språk (whisperSv/whisperEn).
        if (!saved.whisperMeeting && (saved.whisperSv || saved.whisper)) saved.whisperMeeting = saved.whisperSv || saved.whisper;
        if (!saved.whisperDictation && saved.whisperEn) saved.whisperDictation = saved.whisperEn;
        for (const k of ['whisper', 'whisperSv', 'whisperEn']) delete saved[k];
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
  // Användningen avgör modellen: diktering ska vara snabb, möten noggranna.
  modelFor(use) {
    return use === 'dictation' ? this.data.whisperDictation || this.data.whisperMeeting : this.data.whisperMeeting || this.data.whisperDictation;
  }
  policy() {
    return { language: this.data.language, allowed: this.data.allowed, primary: this.data.primary };
  }
}

module.exports = { Settings, DEFAULTS, ICLOUD_OBSIDIAN, DEFAULT_RECORDINGS };
