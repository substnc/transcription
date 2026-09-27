'use strict';
const { BrowserWindow, BaseWindow, WebContentsView, screen } = require('electron');
const path = require('path');

const R = (...p) => path.join(__dirname, '..', 'renderer', ...p);
const PRELOAD = R('preload.js');

function base(extra = {}) {
  return {
    show: false,
    backgroundColor: '#ffffff',
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

function createAbout() {
  const w = new BrowserWindow(base({ width: 460, height: 640, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, title: 'Om Speak', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }));
  w.loadFile(R('about', 'about.html'));
  w.once('ready-to-show', () => w.show());
  return w;
}

// Ett enda fönster för hela appen. Huvudsidan (och Inställningar) och mötet är två vyer i samma fönster,
// och bara en syns åt gången. Mötesvyn ligger kvar när du backar, så inspelning, livetext och resultat
// finns kvar när du kommer tillbaka.
const VIEW_PREFS = { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false };

function createMain() {
  const win = new BaseWindow({ width: 1000, height: 780, minWidth: 760, minHeight: 600, title: 'Speak', show: false,
    backgroundColor: '#ffffff', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } });
  const views = {};
  const fit = () => {
    const { width, height } = win.getContentBounds();
    for (const v of Object.values(views)) v.setBounds({ x: 0, y: 0, width, height });
  };
  win.on('resize', fit);
  const add = (name, file, query) => {
    const v = new WebContentsView({ webPreferences: VIEW_PREFS });
    v.setBackgroundColor('#ffffff');
    views[name] = v;
    win.contentView.addChildView(v);
    fit();
    v.webContents.loadFile(file, query ? { query } : undefined);
    v.webContents.on('destroyed', () => { if (views[name] === v) delete views[name]; });
    return v;
  };
  const shell = {
    win,
    views,
    current: null,
    view(name) { return views[name] || null; },
    // Visar en vy och gömmer de andra. Den som visas läggs överst.
    show(name) {
      for (const [n, v] of Object.entries(views)) v.setVisible(n === name);
      if (views[name]) { win.contentView.addChildView(views[name]); views[name].webContents.focus(); }
      shell.current = name;
      if (!win.isVisible()) win.show();
      win.focus();
    },
    home() { return views.home || add('home', R('home', 'home.html')); },
    meeting(opts = {}) { return views.meeting || add('meeting', R('meeting', 'meeting.html'), opts.upload ? { upload: '1' } : null); },
  };
  shell.home().webContents.once('did-finish-load', () => shell.show(shell.current || 'home'));
  return shell;
}



module.exports = { createMain, createCapture, createOverlay, positionOverlay, createAbout };
