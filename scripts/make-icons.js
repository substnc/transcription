// Ikoner från sub.stnc®-märket (assets/substnc-logo.svg).
// - assets/micTemplate.png (+@2x): menyradsikon, märkets ring som svart mall-PNG (macOS färgar den själv).
// - assets/icon.png: appikon 1024 px, renderas från SVG:n med Electron (scripts/render-icon.js).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(size, alphaAt) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      let a = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) a += alphaAt(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3, size);
      raw[o + 3] = Math.round((a / 9) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Märket i menyraden: yttre skiva (r 462), ljus ring (r 400) och inre skiva (r 236) blir: fylld ring + fylld mitt.
function mark(x, y, s) {
  const r = Math.hypot(x - s / 2, y - s / 2) / (s / 2); // 0..1
  const inRing = r <= 1 && r >= 400 / 462;
  const inCore = r <= 236 / 462;
  return inRing || inCore ? 1 : 0;
}
const out = path.join(__dirname, '..', 'assets');
fs.writeFileSync(path.join(out, 'micTemplate.png'), png(16, mark));
fs.writeFileSync(path.join(out, 'micTemplate@2x.png'), png(32, mark));
console.log('Menyradsikon skriven.');

// Appikon: rendera SVG:n med Electron om den finns, annars behåll befintlig icon.png.
const electron = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
if (fs.existsSync(electron)) {
  try {
    const args = [path.join(__dirname, 'render-icon.js')];
    if (process.platform === 'linux') args.unshift('--no-sandbox');
    execFileSync(electron, args, { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  } catch (e) {
    console.error('Kunde inte rendera appikonen:', e.message);
  }
}
