const test = require('node:test');
const assert = require('node:assert');
const art = require('../src/main/icon-art');

const pngSize = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];

test('ikonen blir en giltig PNG i rätt storlek', () => {
  for (const size of [16, 32, 256]) {
    const png = art.render({ size, tile: size > 32 });
    assert.strictEqual(png.slice(1, 4).toString(), 'PNG');
    assert.deepStrictEqual(pngSize(png), [size, size]);
  }
});

test('vågen rinner ut i en rad: 13 kolumner, raden på mittlinjen', () => {
  assert.strictEqual(art.COLS, 13);
  const row = art.DOTS.filter((d) => d.row);
  assert.strictEqual(row.length, art.ROW);
  assert.ok(row.every((d) => d.y === 0));
  assert.strictEqual(art.DOTS.length, art.WAVE.reduce((a, b) => a + b, 0) + art.ROW);
});

test('lägen: vila tänder allt, lyssna släcker raden, skriva tänder raden en prick i taget', () => {
  const row = art.DOTS.filter((d) => d.row);
  const center = art.DOTS.find((d) => !d.row && d.lvl === 0);
  assert.ok(art.DOTS.every((d) => art.opacity('idle', d, 0.3) === 1));
  assert.ok(row.every((d) => art.opacity('live', d, 0.3) < 0.2));
  assert.strictEqual(art.opacity('live', center, 0.7), 1);
  // Under 'type' lyser inte hela raden samtidigt i början av perioden.
  const lit = row.map((d) => art.opacity('type', d, 0.05));
  assert.ok(Math.max(...lit) > Math.min(...lit));
});

test('animationen ger en hel period bildrutor', () => {
  assert.strictEqual(art.frames('live', { size: 16, tile: false }).length, 12);
  assert.strictEqual(art.frames('type', { size: 16, tile: false }).length, 16);
});
