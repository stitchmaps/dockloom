// Original Dockloom stacked-layer mark; deterministic PNG/ICO with no image dependency.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const size = 256;
const layers = [0, 39, 78].map(d => [[51, 83 + d], [128, 43 + d], [205, 83 + d], [128, 123 + d]]);
function inside(x, y, points) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}
const raw = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const sums = [0, 0, 0, 0];
  for (const dx of [.25, .75]) for (const dy of [.25, .75]) {
    const px = x + dx, py = y + dy;
    const outside = Math.hypot(Math.max(36 - px, px - 220, 0), Math.max(36 - py, py - 220, 0)) > 36;
    let color = outside ? [0, 0, 0, 0] : [94, 106, 210, 255];
    for (let k = layers.length - 1; k >= 0; k--) {
      const outer = layers[k];
      const inner = outer.map(([a, b]) => [128 + (a - 128) * .78, 83 + k * 39 + (b - 83 - k * 39) * .70]);
      if (!outside && inside(px, py, outer) && !inside(px, py, inner)) { color = [247, 248, 248, 255]; break; }
    }
    color.forEach((v, i) => { sums[i] += v / 4; });
  }
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  sums.forEach((v, i) => { raw[offset + i] = Math.round(v); });
}
function crc(data) { let c = 0xffffffff; for (const b of data) { c ^= b; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(kind, data) { const tag = Buffer.from(kind), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([tag, data]))); return Buffer.concat([length, tag, data, checksum]); }
const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
await mkdir('assets', { recursive: true });
await writeFile('assets/icon.png', png);
await writeFile('assets/icon.ico', Buffer.concat([ico, png]));
