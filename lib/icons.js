/**
 * Generador de iconos PNG de la PWA, sin dependencias externas.
 * Dibuja un carrito de la compra blanco sobre fondo verde y exporta
 * `ensureIcons(outDir)`, que crea los iconos solo si faltan.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GREEN = [22, 163, 74, 255];
const WHITE = [255, 255, 255, 255];

// --- CRC32 para los chunks PNG ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const set = (x, y, [r, g, b, a]) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const ea = buf[i + 3] / 255;
    const na = a / 255;
    const oa = na + ea * (1 - na);
    if (oa === 0) return;
    buf[i] = (r * na + buf[i] * ea * (1 - na)) / oa;
    buf[i + 1] = (g * na + buf[i + 1] * ea * (1 - na)) / oa;
    buf[i + 2] = (b * na + buf[i + 2] * ea * (1 - na)) / oa;
    buf[i + 3] = oa * 255;
  };
  return { buf, set, size };
}

function fillRect(c, x0, y0, x1, y1, color) {
  for (let y = Math.round(y0); y < y1; y++) for (let x = Math.round(x0); x < x1; x++) c.set(x, y, color);
}
function fillCircle(c, cx, cy, r, color) {
  for (let y = Math.round(cy - r); y <= cy + r; y++)
    for (let x = Math.round(cx - r); x <= cx + r; x++)
      if (Math.hypot(x - cx, y - cy) <= r) c.set(x, y, color);
}
function thickLine(c, x0, y0, x1, y1, thick, color) {
  const minx = Math.min(x0, x1) - thick, maxx = Math.max(x0, x1) + thick;
  const miny = Math.min(y0, y1) - thick, maxy = Math.max(y0, y1) + thick;
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = Math.round(miny); y <= maxy; y++)
    for (let x = Math.round(minx); x <= maxx; x++) {
      let t = ((x - x0) * dx + (y - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = x0 + t * dx, py = y0 + t * dy;
      if (Math.hypot(x - px, y - py) <= thick / 2) c.set(x, y, color);
    }
}
function fillRoundedBg(c, color, radius) {
  const { size, set } = c;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let inside = true;
      if (x < radius && y < radius) inside = Math.hypot(x - radius, y - radius) <= radius;
      else if (x > size - radius && y < radius) inside = Math.hypot(x - (size - radius), y - radius) <= radius;
      else if (x < radius && y > size - radius) inside = Math.hypot(x - radius, y - (size - radius)) <= radius;
      else if (x > size - radius && y > size - radius)
        inside = Math.hypot(x - (size - radius), y - (size - radius)) <= radius;
      if (inside) set(x, y, color);
    }
}

function drawCart(c) {
  const S = c.size;
  const u = (v) => v * S;
  thickLine(c, u(0.2), u(0.28), u(0.34), u(0.34), u(0.05), WHITE); // mango
  thickLine(c, u(0.32), u(0.36), u(0.74), u(0.36), u(0.05), WHITE); // barra superior
  const topY = u(0.36), botY = u(0.58), topL = u(0.34), topR = u(0.74), botL = u(0.4), botR = u(0.68);
  for (let y = Math.round(topY); y < botY; y++) {
    const f = (y - topY) / (botY - topY);
    const xl = topL + (botL - topL) * f;
    const xr = topR + (botR - topR) * f;
    for (let x = Math.round(xl); x < xr; x++) c.set(x, y, WHITE);
  }
  thickLine(c, u(0.44), u(0.58), u(0.46), u(0.66), u(0.035), WHITE);
  thickLine(c, u(0.64), u(0.58), u(0.62), u(0.66), u(0.035), WHITE);
  fillCircle(c, u(0.46), u(0.7), u(0.045), WHITE);
  fillCircle(c, u(0.62), u(0.7), u(0.045), WHITE);
}

function buildIcon(size, { maskable = false } = {}) {
  const c = makeCanvas(size);
  if (maskable) fillRect(c, 0, 0, size, size, GREEN);
  else fillRoundedBg(c, GREEN, Math.round(size * 0.18));
  drawCart(c);
  return encodePNG(size, size, c.buf);
}

const TARGETS = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-180.png', 180, {}],
  ['icon-maskable.png', 512, { maskable: true }],
];

/** Crea los iconos que falten en outDir. Devuelve los nombres generados. */
function ensureIcons(outDir, { force = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const made = [];
  for (const [name, size, opts] of TARGETS) {
    const file = path.join(outDir, name);
    if (force || !fs.existsSync(file)) {
      fs.writeFileSync(file, buildIcon(size, opts));
      made.push(name);
    }
  }
  return made;
}

module.exports = { ensureIcons, buildIcon };
