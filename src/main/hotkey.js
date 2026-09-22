'use strict';
// Håll-in-tangent via uiohook (kräver Tillgänglighet/Inmatningsövervakning i macOS).
// Reserv: en vanlig global genväg som växlar inspelning av/på.
const { app, globalShortcut } = require('electron');
const EventEmitter = require('events');

const KEY_LABELS = {
  Alt: 'Vänster ⌥ (Option)', Meta: 'Vänster ⌘ (Command)', Ctrl: 'Vänster ⌃ (Control)',
  AltRight: 'Höger ⌥ (Option)', MetaRight: 'Höger ⌘ (Command)', CtrlRight: 'Höger ⌃ (Control)', ShiftRight: 'Höger ⇧ (Shift)',
  F13: 'F13', F14: 'F14', F15: 'F15', F16: 'F16', F17: 'F17', F18: 'F18', F19: 'F19', CapsLock: 'Caps Lock',
};

const TOGGLE_SHORTCUT = 'Alt+Shift+D';

class Hotkey extends EventEmitter {
  constructor() {
    super();
    this.uiohook = null;
    this.keycode = null;
    this.mode = 'hold';
    this.down = false;
    this.active = false;
    this.error = null;
  }

  configure({ hotkey, hotkeyMode }) {
    this.mode = hotkeyMode || 'hold';
    try {
      const { UiohookKey } = require('uiohook-napi');
      this.keycode = UiohookKey[hotkey] || UiohookKey.AltRight;
    } catch (e) {
      this.keycode = null;
      this.error = e.message;
    }
  }

  start() {
    this.startToggleShortcut();
    if (!this.keycode) return false;
    try {
      const { uIOhook } = require('uiohook-napi');
      this.uiohook = uIOhook;
      uIOhook.removeAllListeners();
      uIOhook.on('keydown', (e) => {
        if (e.keycode !== this.keycode || this.down) return;
        this.down = true;
        if (this.mode === 'toggle') this.toggle();
        else this.emit('press');
      });
      uIOhook.on('keyup', (e) => {
        if (e.keycode !== this.keycode) return;
        this.down = false;
        if (this.mode === 'hold') this.emit('release');
      });
      uIOhook.start();
      this.active = true;
      this.error = null;
      return true;
    } catch (e) {
      this.error = e.message;
      this.active = false;
      return false;
    }
  }

  toggle() {
    this.emit('toggle');
  }

  startToggleShortcut() {
    globalShortcut.unregister(TOGGLE_SHORTCUT);
    try {
      globalShortcut.register(TOGGLE_SHORTCUT, () => this.toggle());
    } catch (e) {
      console.error('Kunde inte registrera genväg', e.message);
    }
  }

  stop() {
    try {
      if (this.uiohook) this.uiohook.stop();
    } catch { /* ignorera */ }
    if (app.isReady()) globalShortcut.unregisterAll();
    this.active = false;
  }

  restart(cfg) {
    this.stop();
    this.configure(cfg);
    return this.start();
  }
}

module.exports = { Hotkey, KEY_LABELS, TOGGLE_SHORTCUT };
