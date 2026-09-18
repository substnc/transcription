// Skapar logotyp och ikoner utan externa beroenden.
// Märket: tre ljudstaplar i olika höjd. Läses som "lyssnar" och rimmar med tidslinjen i appen.
// - assets/micTemplate.png (+@2x): menyradsikon, svart mall-PNG som macOS färgar själv.
// - assets/icon.png: appikon 1024 px, mörk rundad platta, offwhite staplar och en tegelröd.
// - assets/logo.svg: vektorlogotyp med ordmärke.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
// pixel(x, y) -> [r, g, b, a] med 0..1
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      // 4x supersampling för mjuka kanter
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const [pr, pg, pb, pa] = pixel(x + (sx + 0.5) / 2, y + (sy + 0.5) / 2, size);
        r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
      }
      if (a > 0) { r /= a; g /= a; b /= a; }
      a /= 4;
      raw[o] = Math.round(r * 255); raw[o + 1] = Math.round(g * 255); raw[o + 2] = Math.round(b * 255); raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Avstånd till rundad rektangel (negativt = inuti)
function rrect(x, y, cx, cy, w, h, r) {
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0), dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
  return Math.sqrt(dx * dx + dy * dy) - r;
}
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d));

// Tre staplar, i enheter av 16. Mitten högst. Returnerar [täckning, index]
const BARS = [{ x: 4.0, h: 6 }, { x: 8.0, h: 11 }, { x: 12.0, h: 8 }];
function bars(x, y, s, width = 2.2) {
  const u = s / 16;
  let best = 0, idx = -1;
  BARS.forEach((b, i) => {
    const c = cover(rrect(x, y, b.x * u, 8 * u, width * u, b.h * u, width * u / 2));
    if (c > best) { best = c; idx = i; }
  });
  return [best, idx];
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });

// Menyradsikon: svart med alfa (mall)
const tray = (x, y, s) => [0, 0, 0, bars(x, y, s)[0]];
fs.writeFileSync(path.join(out, 'micTemplate.png'), png(16, tray));
fs.writeFileSync(path.join(out, 'micTemplate@2x.png'), png(32, tray));

// Appikon: mörk platta med macOS-radie (~22 %), staplar i offwhite, mittstapeln tegelröd
const BG = [0x12 / 255, 0x12 / 255, 0x10 / 255], FG = [0xF2 / 255, 0xEF / 255, 0xE8 / 255], AC = [0xE0 / 255, 0x5A / 255, 0x3C / 255];
function appIcon(x, y, s) {
  const plate = cover(rrect(x, y, s / 2, s / 2, s * 0.86, s * 0.86, s * 0.19));
  if (plate <= 0) return [0, 0, 0, 0];
  const inner = s * 0.62, off = (s - inner) / 2;
  const [c, i] = bars(x - off, y - off, inner, 2.4);
  const col = i === 1 ? AC : FG;
  const r = BG[0] * (1 - c) + col[0] * c, g = BG[1] * (1 - c) + col[1] * c, b = BG[2] * (1 - c) + col[2] * c;
  return [r, g, b, plate];
}
fs.writeFileSync(path.join(out, 'icon.png'), png(1024, appIcon));

// Vektorlogotyp: märke + ordmärke
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96" viewBox="0 0 360 96">
  <rect x="0" y="0" width="96" height="96" rx="20" fill="#121210"/>
  <rect x="26.4" y="35" width="8" height="26" rx="4" fill="#F2EFE8"/>
  <rect x="44" y="22" width="8" height="52" rx="4" fill="#E05A3C"/>
  <rect x="61.6" y="29" width="8" height="38" rx="4" fill="#F2EFE8"/>
  <text x="120" y="66" font-family="'Instrument Serif', Georgia, serif" font-size="56" fill="#121210">Diktera</text>
</svg>
`;
fs.writeFileSync(path.join(out, 'logo.svg'), svg);
console.log('Ikoner och logotyp skrivna till', out);
