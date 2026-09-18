// Renderar assets/substnc-logo.svg till assets/icon.png (1024 px) med Electron.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'substnc-logo.svg'), 'utf8');
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  // macOS-ikoner har luft runt sig: märket fyller 82 % av ytan.
  const html = `<html><body style="margin:0;background:transparent;display:flex;align-items:center;justify-content:center;width:1024px;height:1024px">${svg.replace('<svg ', '<svg width="840" height="840" ')}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), img.toPNG());
  console.log('Appikon renderad:', img.getSize());
  app.exit(0);
});
