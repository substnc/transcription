// Ikoner från Speaks prickvåg (src/main/icon-art.js, samma kod som animerar ikonen i appen).
// - assets/icon.png: appikon 1024 px, svart rundad ruta med vita prickar.
// - assets/trayTemplate.png (+@2x): menyradsikon, svarta prickar som mall-bild (macOS färgar den själv).
const fs = require('fs');
const path = require('path');
const art = require('../src/main/icon-art');

const out = path.join(__dirname, '..', 'assets');
fs.writeFileSync(path.join(out, 'icon.png'), art.render({ size: 1024 }));
fs.writeFileSync(path.join(out, 'trayTemplate.png'), art.render({ size: 16, tile: false }));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), art.render({ size: 32, tile: false }));
console.log('Ikoner skrivna i assets/.');
