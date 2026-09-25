#!/usr/bin/env node
// Generates the extension icons without dependencies.
// icon*.png: a red rounded square with a white envelope, for the store, the extensions page and notifications.
// toolbar*.png: a red envelope centered, for the toolbar when there is no badge.
// toolbar-badge*.png: the same envelope raised into the top half with the bottom left clear, so Chrome's count badge
// (drawn over the bottom of the toolbar icon) covers empty space instead of the envelope.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RED = [217, 48, 37];
const WHITE = [255, 255, 255];

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const [r, g, b, a] = pixel(i + 0.5, j + 0.5);
      raw.set([r, g, b, a].map(v => Math.round(Math.max(0, Math.min(255, v)))), j * (size * 4 + 1) + 1 + i * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function sdRoundedRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - hw + r, dy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}
function sdSegment(x, y, ax, ay, bx, by) {
  const px = x - ax, py = y - ay, vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - t * vx, py - t * vy);
}
// Signed distance -> 0..1 coverage with a 1px anti-alias.
const coverage = d => Math.max(0, Math.min(1, 0.5 - d));
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

// Envelope: body box (cx, cy, hw, hh) with a V-shaped flap from the top corners (moved in by inset) down to (cx, tipY).
function envelope(x, y, s, { cx, cy, hw, hh, tipY, line, inset = 0 }) {
  const body = coverage(sdRoundedRect(x, y, cx, cy, hw, hh, s * 0.04));
  const top = cy - hh + inset;
  const flap = Math.min(sdSegment(x, y, cx - hw + inset, top, cx, tipY), sdSegment(x, y, cx + hw - inset, top, cx, tipY));
  return { body, flap: coverage(flap - line) };
}

function appIcon(s) {
  return png(s, (x, y) => {
    const bg = coverage(sdRoundedRect(x, y, s / 2, s / 2, s / 2, s / 2, s * 0.22));
    const env = envelope(x, y, s, { cx: s / 2, cy: s * 0.52, hw: s * 0.30, hh: s * 0.21, tipY: s * 0.55, line: s * 0.045 });
    const rgb = mix(mix(RED, WHITE, env.body), RED, env.flap * env.body);
    return [...rgb, bg * 255];
  });
}

// Toolbar: centered, the envelope keeps a letter's proportions; raised, it flattens to fit the top half,
// since the badge covers roughly the bottom 40%.
function toolbarIcon(s, raised) {
  const shape = raised ? { cy: 0.31, hw: 0.47, hh: 0.27, tip: 0.05 } : { cy: 0.5, hw: 0.45, hh: 0.32, tip: 0.07 };
  return png(s, (x, y) => {
    const env = envelope(x, y, s, {
      cx: s / 2, cy: s * shape.cy, hw: s * shape.hw, hh: s * shape.hh, tipY: s * (shape.cy + shape.tip), line: s * 0.06, inset: s * 0.06
    });
    // The flap is cut out of the red body so it shows the toolbar color on any theme.
    return [...RED, env.body * (1 - env.flap) * 255];
  });
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(out, `icon${size}.png`), appIcon(size));
  console.log(`wrote icon${size}.png`);
}
for (const size of [16, 24, 32]) {
  fs.writeFileSync(path.join(out, `toolbar${size}.png`), toolbarIcon(size, false));
  fs.writeFileSync(path.join(out, `toolbar-badge${size}.png`), toolbarIcon(size, true));
  console.log(`wrote toolbar${size}.png, toolbar-badge${size}.png`);
}
