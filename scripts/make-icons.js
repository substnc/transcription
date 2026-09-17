// Skapar menyradsikonen (mall-PNG i svart med alfa) utan externa beroenden.
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
  const len = Buffer.alloc(4); len.writeUInt32LE; len.writeUInt32BE(data.length, 0);
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
      raw[o] = 0; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = Math.round(255 * Math.max(0, Math.min(1, alphaAt(x + 0.5, y + 0.5, size))));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Enkel mikrofon: kapsel (rundad rektangel), bygel (halvcirkel), fot.
function mic(x, y, s) {
  const u = s / 16;
  const inside = (cx, cy, w, h, r) => {
    const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0), dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
    return Math.sqrt(dx * dx + dy * dy) - r;
  };
  let d = inside(8 * u, 6 * u, 5 * u, 9 * u, 2.5 * u); // kapsel
  const rr = Math.hypot(x - 8 * u, y - 8 * u); // bygel
  const ring = y > 8 * u ? Math.abs(rr - 4.6 * u) - 0.7 * u : 1e9;
  d = Math.min(d, ring);
  d = Math.min(d, inside(8 * u, 13.2 * u, 1.4 * u, 2.4 * u, 0.5 * u)); // stjälk
  d = Math.min(d, inside(8 * u, 14.6 * u, 5 * u, 1.3 * u, 0.6 * u)); // fot
  return 0.5 - d / u; // antialias ungefär en pixel
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'micTemplate.png'), png(16, mic));
fs.writeFileSync(path.join(out, 'micTemplate@2x.png'), png(32, mic));
// App-ikon (större, samma glyf) används som placeholder för .icns via electron-builder.
fs.writeFileSync(path.join(out, 'icon.png'), png(512, (x, y, s) => (Math.hypot(x - s / 2, y - s / 2) < s * 0.46 ? 0.12 : 0) + Math.max(0, mic(x * 0.6 + s * 0.2, y * 0.6 + s * 0.2, s))));
console.log('Ikoner skrivna till', out);
