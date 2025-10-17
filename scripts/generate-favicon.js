/* eslint-env node */
/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 16;
const NASA_BLUE = { r: 0x0b, g: 0x3d, b: 0x91 };
const WHITE = { r: 0xff, g: 0xff, b: 0xff };

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function buildPixelData() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const center = (SIZE - 1) / 2;
  const radius = SIZE / 2;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const norm = dist / radius;
      const inside = norm <= 1;
      const falloff = inside ? Math.max(0, 1 - norm) : 0;

      const r = lerp(NASA_BLUE.r, WHITE.r, falloff * 0.35);
      const g = lerp(NASA_BLUE.g, WHITE.g, falloff * 0.35);
      const b = lerp(NASA_BLUE.b, WHITE.b, falloff * 0.35);
      const alpha = inside ? 0xff : 0x00;

      const idx = (y * SIZE + x) * 4;
      pixels[idx + 0] = b;
      pixels[idx + 1] = g;
      pixels[idx + 2] = r;
      pixels[idx + 3] = alpha;
    }
  }

  return pixels;
}

function buildAndMask() {
  // 1 bit per pixel, rows padded to 32 bits => SIZE / 8 rounded up to 4 bytes per row
  const rowSize = 4;
  const mask = Buffer.alloc(rowSize * SIZE);
  // fully transparent pixels already handled via alpha channel, keep mask zeroed
  return mask;
}

function writeUInt16LE(buf, value, offset) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
}

function writeUInt32LE(buf, value, offset) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

function buildIco(pixels, mask) {
  const header = Buffer.alloc(6);
  writeUInt16LE(header, 0, 0); // reserved
  writeUInt16LE(header, 1, 2); // icon type
  writeUInt16LE(header, 1, 4); // one image

  const dibHeader = Buffer.alloc(40);
  writeUInt32LE(dibHeader, 40, 0); // header size
  writeUInt32LE(dibHeader, SIZE, 4); // width
  writeUInt32LE(dibHeader, SIZE * 2, 8); // height doubled for XOR+AND
  writeUInt16LE(dibHeader, 1, 12); // planes
  writeUInt16LE(dibHeader, 32, 14); // bit count
  writeUInt32LE(dibHeader, 0, 16); // compression (BI_RGB)
  writeUInt32LE(dibHeader, pixels.length + mask.length, 20); // image size
  writeUInt32LE(dibHeader, 0, 24); // x ppm
  writeUInt32LE(dibHeader, 0, 28); // y ppm
  writeUInt32LE(dibHeader, 0, 32); // colors used
  writeUInt32LE(dibHeader, 0, 36); // important colors

  const bytesInRes = dibHeader.length + pixels.length + mask.length;
  const imageOffset = header.length + 16; // ICONDIR + entry size

  const entry = Buffer.alloc(16);
  entry[0] = SIZE; // width
  entry[1] = SIZE; // height
  entry[2] = 0; // color count
  entry[3] = 0; // reserved
  writeUInt16LE(entry, 1, 4); // planes
  writeUInt16LE(entry, 32, 6); // bit count
  writeUInt32LE(entry, bytesInRes, 8); // bytes in resource
  writeUInt32LE(entry, imageOffset, 12); // image offset

  return Buffer.concat([header, entry, dibHeader, pixels, mask]);
}

function main() {
  const outPath = path.resolve('public/favicon.ico');
  ensureDir(outPath);
  const pixels = buildPixelData();
  const mask = buildAndMask();
  const ico = buildIco(pixels, mask);
  fs.writeFileSync(outPath, ico);
  console.log(`Generated favicon at ${outPath} (${ico.length} bytes)`);
}

main();
