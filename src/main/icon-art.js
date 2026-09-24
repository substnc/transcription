'use strict';
// Speaks ikon: en vågform av prickar som rinner ut i en rad, "röst blir text".
// Ritas i kod (ingen bildfil) så att samma form används för appikon, menyrad och Dock-animationen.
// Rena funktioner utan Electron, så att de går att testa och användas av scripts/make-icons.js.
const zlib = require('zlib');

// Vågen: antal prickar per kolumn. Därefter en rad med ROW prickar på mittlinjen.
const WAVE = [1, 3, 7, 11, 13, 9, 5, 3];
const ROW = 5;
const COLS = WAVE.length + ROW; // 13 kolumner

// Alla prickar i rutnätsenheter: x = kolumn (0..12), y = rader från mitten, lvl = avstånd från mitten.
function dots() {
  const out = [];
  WAVE.forEach((k, col) => {
    for (let j = 0; j < k; j++) {
      const y = j - (k - 1) / 2;
      out.push({ x: col, y, lvl: Math.abs(y), col, row: false });
    }
  });
  for (let j = 0; j < ROW; j++) out.push({ x: WAVE.length + j, y: 0, lvl: 0, col: WAVE.length + j, row: true, idx: j });
  return out;
}
const DOTS = dots();

const DIM = 0.14;
const frac = (v) => v - Math.floor(v);
const clamp = (v) => Math.max(0, Math.min(1, v));
// Mjuk övergång mellan släckt och tänd: 1 inne i fönstret [a, b], DIM utanför, rampar på `edge`.
function windowed(p, a, b, edge = 0.04) {
  const on = Math.min(clamp((p - a) / edge + 0.5), clamp((b - p) / edge + 0.5));
  return DIM + (1 - DIM) * on;
}

// Hur starkt en prick lyser (0..1) vid tiden t sekunder, i ett visst läge.
// idle/done: allt tänt. live: vågen andas, raden är släckt. type: vågen vilar, raden tänds en prick i taget.
const PERIOD = { live: 1.2, type: 1.6 };
function opacity(state, d, t) {
  if (state === 'live') {
    if (d.row) return DIM;
    if (d.lvl === 0) return 1;
    const f = 1 - d.lvl / 7;
    const p = frac(t / PERIOD.live + d.col * 0.11);
    return windowed(p, 0.5 - f * 0.48, 0.5 + f * 0.48);
  }
  if (state === 'type') {
    if (!d.row) return d.lvl === 0 ? 0.6 : 0.28;
    const p = frac(t / PERIOD.type - d.idx * 0.0875);
    if (p < 0.12) return DIM + (1 - DIM) * (p / 0.12);
    if (p < 0.7) return 1;
    if (p < 0.88) return 1 - (1 - DIM) * ((p - 0.7) / 0.18);
    return DIM;
  }
  return 1;
}

// ---- Rastrering till PNG ----
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
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
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Rundad kvadrat (macOS-ikonens form) som täckningsgrad 0..1 i punkten (x, y).
function inRoundRect(x, y, x0, y0, w, r) {
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + w - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

// Ritar ikonen. opts:
//   size: bildens sida i pixlar
//   tile: true = svart rundad ruta med vita prickar (appikon), false = bara prickar (menyraden)
//   color: prickarnas färg utan ruta, [r, g, b] (svart som standard, mall-bild för menyraden)
//   state, t: läge och tid för animationen
function render({ size, tile = true, color = [0, 0, 0], state = 'idle', t = 0 }) {
  // Appikon: rutan fyller 824/1024 som Apples mall, prickarna ~62 % av rutan. Menyrad: prickarna fyller bilden.
  const tileW = tile ? size * (824 / 1024) : size;
  const x0 = (size - tileW) / 2;
  const art = tile ? tileW * 0.62 : size * 0.98;
  const sp = art / (COLS - 0.5);
  const r = tile ? sp * 0.3 : sp * 0.38;
  const ox = size / 2 - ((COLS - 1) / 2) * sp;
  const oy = size / 2;
  const alpha = DOTS.map((d) => opacity(state, d, t));
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 3; // översampling för mjuka kanter
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, dot = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS, y = py + (sy + 0.5) / SS;
          if (tile && inRoundRect(x, y, x0, x0, tileW, tileW * 0.225)) bg++;
          // Närmaste rutnätspunkt räcker: prickarna överlappar aldrig.
          const col = Math.round((x - ox) / sp);
          if (col < 0 || col >= COLS) continue;
          const row = Math.round((y - oy) / sp * 2) / 2; // halva steg för kolumner med jämnt antal
          for (const d of candidates(col, row)) {
            if (Math.hypot(x - (ox + d.x * sp), y - (oy + d.y * sp)) <= r) { dot += alpha[d.i]; break; }
          }
        }
      }
      const n = SS * SS, o = (py * size + px) * 4;
      if (tile) {
        // Svart ruta, vita prickar med sin ljusstyrka.
        const a = bg / n, w = Math.round((dot / n) * 255);
        rgba[o] = w; rgba[o + 1] = w; rgba[o + 2] = w; rgba[o + 3] = Math.round(a * 255);
      } else {
        rgba[o] = color[0]; rgba[o + 1] = color[1]; rgba[o + 2] = color[2]; rgba[o + 3] = Math.round((dot / n) * 255);
      }
    }
  }
  return encodePng(size, rgba);
}
// Prickar per kolumn, för snabb uppslagning.
const BY_COL = [];
DOTS.forEach((d, i) => { d.i = i; (BY_COL[d.col] = BY_COL[d.col] || []).push(d); });
function candidates(col, row) {
  return (BY_COL[col] || []).filter((d) => Math.abs(d.y - row) <= 0.5);
}

// Bildrutor för en animation: `fps` bilder per sekund, en hel period.
function frames(state, opts, fps = 10) {
  const n = Math.round((PERIOD[state] || 1) * fps);
  return Array.from({ length: n }, (_, i) => render({ ...opts, state, t: i / fps }));
}

module.exports = { WAVE, ROW, COLS, DOTS, PERIOD, opacity, render, frames, encodePng };
