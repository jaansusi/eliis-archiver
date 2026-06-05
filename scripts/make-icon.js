'use strict';

// Generates build/icon.png (1024x1024) — a rounded blue tile with a white
// "download" glyph (down arrow over a tray). Pure Node, no dependencies: the
// PNG is hand-encoded. Run with `npm run make-icon`.
//
// On macOS this also builds build/icon.icns (via sips + iconutil) when available.
// electron-builder uses build/icon.* automatically when packaging.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const SIZE = 1024;
const OUT_DIR = path.join(__dirname, '..', 'build');

// ---- tiny raster canvas (RGBA) ----------------------------------------------
const buf = Buffer.alloc(SIZE * SIZE * 4); // transparent

function px(x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const sa = a / 255;
  const da = buf[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / oa);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
  buf[i + 3] = Math.round(oa * 255);
}

// Soft edge: coverage 0..1 over a ~1px band around an SDF distance.
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d));

function lerp(a, b, t) { return a + (b - a) * t; }

// rounded-rect signed distance
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

// point-in-triangle via barycentric sign (returns signed-ish coverage)
function inTriangle(px_, py_, ax, ay, bx, by, cx, cy) {
  const d1 = (px_ - bx) * (ay - by) - (ax - bx) * (py_ - by);
  const d2 = (px_ - cx) * (by - cy) - (bx - cx) * (py_ - cy);
  const d3 = (px_ - ax) * (cy - ay) - (cx - ax) * (py_ - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// ---- draw -------------------------------------------------------------------
const BG_TOP = [74, 158, 255];   // --accent
const BG_BOT = [47, 109, 191];   // --accent-dim
const WHITE = [255, 255, 255, 255];

const cx = SIZE / 2;
const tileHW = SIZE / 2 - 40; // small margin
const radius = 200;

// arrow geometry
const stemHalf = 70;
const stemTop = 250;
const stemBot = 560;
const headHalf = 200;
const headTop = 470;
const headTip = 720;
// tray (baseline the arrow points into)
const trayY = 800, trayH = 70, trayHW = 250, trayR = 35;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // background tile with vertical gradient
    const d = sdRoundRect(x, y, cx, cx, tileHW, tileHW, radius);
    const c = cov(d);
    if (c > 0) {
      const t = y / SIZE;
      px(x, y, [
        Math.round(lerp(BG_TOP[0], BG_BOT[0], t)),
        Math.round(lerp(BG_TOP[1], BG_BOT[1], t)),
        Math.round(lerp(BG_TOP[2], BG_BOT[2], t)),
        Math.round(255 * c),
      ]);
    }

    // white glyph
    let g = 0;
    // stem
    if (x > cx - stemHalf && x < cx + stemHalf && y > stemTop && y < stemBot) g = 1;
    // arrowhead
    if (y >= headTop && y <= headTip &&
        inTriangle(x, y, cx - headHalf, headTop, cx + headHalf, headTop, cx, headTip)) g = 1;
    // tray
    if (sdRoundRect(x, y, cx, trayY, trayHW, trayH / 2, trayR) < 0) g = 1;
    if (g) px(x, y, WHITE);
  }
}

// ---- encode PNG -------------------------------------------------------------
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const pngPath = path.join(OUT_DIR, 'icon.png');
fs.writeFileSync(pngPath, encodePng(SIZE, SIZE, buf));
console.log('wrote', pngPath);

// ---- macOS: build .icns -----------------------------------------------------
if (process.platform === 'darwin') {
  try {
    const set = path.join(OUT_DIR, 'icon.iconset');
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set);
    const sizes = [16, 32, 64, 128, 256, 512, 1024];
    for (const s of sizes) {
      execSync(`sips -z ${s} ${s} "${pngPath}" --out "${path.join(set, `icon_${s}x${s}.png`)}"`, { stdio: 'ignore' });
      if (s <= 512) {
        execSync(`sips -z ${s * 2} ${s * 2} "${pngPath}" --out "${path.join(set, `icon_${s}x${s}@2x.png`)}"`, { stdio: 'ignore' });
      }
    }
    execSync(`iconutil -c icns "${set}" -o "${path.join(OUT_DIR, 'icon.icns')}"`, { stdio: 'ignore' });
    fs.rmSync(set, { recursive: true, force: true });
    console.log('wrote', path.join(OUT_DIR, 'icon.icns'));
  } catch (e) {
    console.warn('icns generation skipped:', e.message);
  }
}
