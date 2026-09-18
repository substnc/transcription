'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const R = (...p) => path.join(__dirname, '..', 'renderer', ...p);
const PRELOAD = R('preload.js');

function base(extra = {}) {
  return {
    show: false,
    backgroundColor: '#121210',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    ...extra,
  };
}

// Osynligt fönster som bara äger mikrofonen.
function createCapture() {
  const w = new BrowserWindow(base({ width: 200, height: 100, show: false, skipTaskbar: true }));
  w.loadFile(R('capture', 'capture.html'));
  return w;
}

// Liten "pill" som visar status vid diktering.
function createOverlay() {
  const w = new BrowserWindow(base({
    width: 220, height: 44, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, resizable: false, movable: false,
    focusable: false, skipTaskbar: true, hasShadow: false, type: 'panel',
  }));
  w.setIgnoreMouseEvents(true);
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.loadFile(R('overlay', 'overlay.html'));
  return w;
}

function positionOverlay(w) {
  const cursor = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = d.workArea;
  const [ww, wh] = w.getSize();
  w.setPosition(Math.round(x + (width - ww) / 2), Math.round(y + height - wh - 24));
}

function createMeeting() {
  const w = new BrowserWindow(base({ width: 1000, height: 780, minWidth: 760, minHeight: 560, title: 'Speak – Mötesläge', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }));
  w.loadFile(R('meeting', 'meeting.html'));
  w.once('ready-to-show', () => w.show());
  return w;
}

function createSettings() {
  const w = new BrowserWindow(base({ width: 700, height: 820, minWidth: 580, minHeight: 500, title: 'Speak – Inställningar', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }));
  w.loadFile(R('settings', 'settings.html'));
  w.once('ready-to-show', () => w.show());
  return w;
}

module.exports = { createCapture, createOverlay, positionOverlay, createMeeting, createSettings };
