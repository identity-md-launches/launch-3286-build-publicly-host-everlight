// Everlight Garden pixel asset generator. Original artwork drawn in code for this project (CC0 1.0).
// Every sprite is authored pixel by pixel from one shared 16-bit palette and written as an indexed-look
// RGBA PNG at 1 art pixel = 1 image pixel. The site scales them with nearest-neighbour sampling only.
// Usage (from web/): node art-src/pixel/build.mjs  -> public/art/px/*.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../public/art/px");
mkdirSync(OUT, { recursive: true });

// ---- palette (shared with src/garden/palette.ts) ----
export const P = {
  K: "#050a08", D1: "#0b1712", D2: "#12251b", G1: "#1c3a26", G2: "#2a5233", G3: "#3f7a3c", G4: "#6aa84f", G5: "#a7d36a",
  S1: "#262824", S2: "#3f413a", S3: "#646453", S4: "#8f8b74", S5: "#c4bb98",
  W1: "#04201f", W2: "#0b3f3a", W3: "#12695b", W4: "#2fb38d", W5: "#9ff0cf",
  Y1: "#5a3510", Y2: "#9a5f1c", Y3: "#d79a32", Y4: "#f5c95a", Y5: "#fff2b0", F: "#fffbe8",
  V: "#efe6cc", V2: "#cdbf9c", FL: "#f4f1e4", FC: "#e8c34a",
  R1: "#1f4d1e", R2: "#3e8a2f", R3: "#6cc04a", EW: "#f0efe6", LP: "#a8463a",
  B1: "#3a2414", B2: "#6a4424", B3: "#9a6a3a", C1: "#1d2c55", C2: "#34508f", H1: "#4a3a26", H2: "#6e5838",
  T1: "#9a7a32", T2: "#c9a24a", T3: "#e8c870", L1: "#7dffb0", L2: "#c8ffe0", I1: "#1a1f1c", O1: "#a8501e", O2: "#f0a14a",
};
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || !c) return;
    const [r, g, b] = rgb(P[c] ?? c); const i = (y * this.w + x) * 4;
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255;
  }
  get(x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0; return this.d[(y * this.w + x) * 4 + 3]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  /** filled ellipse, shade(c, dx, dy) picks a colour per pixel (dx, dy in -1..1) */
  oval(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0) this.set(x, y, typeof c === "function" ? c(dx, dy, x, y) : c);
    }
  }
  /** strings map: each char is a palette key via legend; '.' transparent */
  map(x0, y0, rows, legend) { rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== "." && ch !== " ") this.set(x0 + x, y0 + y, legend[ch] ?? ch); })); }
  outline(c = "K") {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (!this.get(x, y) && (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1))) add.push([x, y]);
    add.forEach(([x, y]) => this.set(x, y, c));
  }
  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) { raw[y * (this.w * 4 + 1)] = 0; Buffer.from(this.d.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1); }
    const chunk = (t, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(t), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(this.w, 0); ihdr.writeUInt32BE(this.h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  }
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const files = [];
const all = [];
const save = (name, p) => { all.push(p); writeFileSync(join(OUT, `${name}.png`), p.png()); files.push(`${name}.png ${p.w}x${p.h}`); };
const B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const dith = (x, y, t) => B4[y & 3][x & 3] / 16 < t;

// ---------- tiles 16x16 ----------
function tile(name, fn) { const p = new Pix(16, 16); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) p.set(x, y, fn(x, y)); save(name, p); }
seed = 11; const gnoise = Array.from({ length: 256 }, rnd);
tile("tile-grass", (x, y) => { const n = gnoise[y * 16 + x]; return n < 0.08 ? "G3" : n < 0.3 ? "G2" : n > 0.93 ? "D2" : "G1"; });
tile("tile-grass-dark", (x, y) => { const n = gnoise[((y * 7 + x * 3) & 255)]; return n < 0.1 ? "G2" : n < 0.55 ? "G1" : "D2"; });
// flagstone: irregular slabs with dark joints and moss in joints
tile("tile-path", (x, y) => {
  const row = y < 8 ? 0 : 1, off = row ? 5 : 0, jx = (x + off) % 8;
  if (y === 0 || y === 8 || jx === 0) return gnoise[y * 16 + x] < 0.35 ? "G2" : "S1";
  const n = gnoise[(y * 16 + x * 5) & 255];
  return n < 0.15 ? "S2" : n > 0.85 ? "S4" : (y % 8 === 1 || jx === 1) ? "S4" : "S3";
});
// retaining wall: brick courses, lit top edge per brick, mossy flecks
tile("tile-wall", (x, y) => {
  const row = Math.floor(y / 4), off = row % 2 ? 4 : 0, jx = (x + off) % 8;
  if (y % 4 === 3 || jx === 7) return "S1";
  if (gnoise[y * 16 + x] < 0.1) return "G2";
  return y % 4 === 0 ? "S4" : gnoise[(x * 13 + y) & 255] < 0.3 ? "S2" : "S3";
});
tile("tile-moss-stone", (x, y) => { const n = gnoise[(x * 31 + y * 17) & 255]; return n < 0.35 ? "G3" : n < 0.5 ? "G4" : n < 0.8 ? "S3" : "S2"; });
for (let f = 0; f < 3; f++) tile(`tile-water-${f}`, (x, y) => {
  const w = Math.sin((x + f * 5) * 0.8 + y * 1.7) + Math.sin(y * 0.9 - f * 2);
  return w > 1.5 ? "W5" : w > 0.9 ? "W4" : w > -0.3 ? "W3" : w > -1.2 ? "W2" : "W1";
});

// ---------- candle holders ----------
{ // empty holder 12x13: black iron cup on a squat mossy stone foot (cup rim 12px above the foot)
  const p = new Pix(12, 14);
  p.map(0, 0, [
    "............",
    "..KKKKKKKK..",
    ".KS2S1S1S1K.",
  ].slice(0, 0), {});
  p.rect(2, 1, 8, 2, "S1"); p.rect(3, 1, 6, 1, "K"); p.set(2, 1, "S2"); p.set(9, 1, "S2");
  p.rect(3, 3, 6, 5, "S1"); p.rect(3, 3, 1, 5, "S2"); p.rect(8, 3, 1, 5, "K");
  p.rect(1, 8, 10, 2, "S4"); p.rect(1, 10, 10, 2, "S3"); p.rect(1, 12, 10, 1, "S2");
  p.set(2, 8, "G4"); p.set(3, 8, "G3"); p.set(9, 11, "G3"); p.set(1, 12, "G2");
  p.outline(); save("holder", p);
}
{ // hero pedestal for the founding candle: carved octagon with a gold leaf emblem, 30x24
  const p = new Pix(30, 24);
  p.rect(3, 2, 24, 3, "S4"); p.rect(2, 5, 26, 2, "S5"); p.rect(4, 7, 22, 12, "S3");
  for (let y = 7; y < 19; y++) { p.set(4, y, "S4"); p.set(25, y, "S2"); p.set(5, y, "S4"); p.set(24, y, "S2"); }
  p.rect(2, 19, 26, 3, "S2"); p.rect(2, 19, 26, 1, "S4");
  // leaf emblem
  const em = [[14, 9], [15, 9], [13, 10], [14, 10], [15, 10], [16, 10], [11, 11], [14, 11], [15, 11], [18, 11], [12, 12], [13, 12], [14, 12], [15, 12], [16, 12], [17, 12], [13, 13], [14, 13], [15, 13], [16, 13], [14, 14], [15, 14]];
  em.forEach(([x, y]) => p.set(x, y, y < 11 ? "Y4" : "Y3")); p.set(14, 15, "Y2"); p.set(15, 15, "Y2");
  p.set(3, 20, "G4"); p.set(4, 20, "G3"); p.set(26, 21, "G3"); p.set(3, 2, "G3"); p.set(4, 2, "G4");
  p.outline(); save("pedestal-hero", p);
}

// ---------- candles: 8x14 each, wick at (wx, top row of wax); the flame sits above it ----------
const CANDLES = [];
function candle(i, name, draw, wickY) { const p = new Pix(10, 16); draw(p); p.outline(); save(`candle-${i}`, p); CANDLES.push({ i, name, wickY }); }
candle(0, "Moon taper", (p) => { // tall ivory taper in a small silver cup
  p.rect(4, 2, 2, 10, "V"); p.rect(4, 2, 1, 10, "FL"); p.rect(5, 3, 1, 9, "V2"); p.set(4, 1, "S1");
  p.rect(2, 12, 6, 2, "S4"); p.rect(3, 14, 4, 1, "S3"); p.set(2, 12, "S5");
}, 1);
candle(1, "Ember pillar", (p) => { // wide amber pillar with melted rim
  p.rect(2, 5, 6, 9, "O1"); p.rect(3, 5, 3, 9, "O2"); p.rect(2, 5, 6, 1, "Y4"); p.set(2, 6, "Y3"); p.set(7, 7, "Y3");
  p.set(5, 4, "S1"); p.rect(1, 14, 8, 1, "Y1");
}, 4);
candle(2, "Lantern bloom", (p) => { // brass lantern: cap, glass box, base
  p.rect(3, 1, 4, 1, "Y2"); p.rect(2, 2, 6, 1, "Y3"); p.rect(2, 3, 1, 9, "Y2"); p.rect(7, 3, 1, 9, "Y2");
  p.rect(3, 3, 4, 9, "Y5"); p.rect(4, 9, 2, 3, "V"); p.rect(2, 12, 6, 2, "Y3"); p.rect(3, 14, 4, 1, "Y1"); p.set(4, 0, "Y3");
}, 8);
candle(3, "Lily float", (p) => { // white lily cup on a green pad
  p.rect(0, 13, 10, 2, "G3"); p.rect(1, 13, 8, 1, "G4"); p.set(5, 14, "G1");
  p.rect(2, 9, 6, 4, "FL"); p.set(1, 8, "FL"); p.set(8, 8, "FL"); p.set(3, 7, "FL"); p.set(6, 7, "FL"); p.rect(4, 10, 2, 2, "FC"); p.set(2, 12, "V2"); p.set(7, 12, "V2");
  p.rect(4, 8, 2, 2, "V");
}, 8);
candle(4, "Gilded spiral", (p) => { // twisted gold candle in a dark emerald cup
  for (let y = 2; y < 11; y++) { p.set(4, y, (y % 3) ? "Y4" : "Y2"); p.set(5, y, (y % 3) === 1 ? "Y2" : "Y3"); }
  p.set(4, 1, "S1"); p.rect(2, 11, 6, 3, "G2"); p.rect(2, 11, 6, 1, "G4"); p.rect(3, 14, 4, 1, "Y2");
}, 2);
candle(5, "Frog lamp", (p) => { // small stone frog carrying a wick dish on its head
  p.oval(5, 11, 4, 3, (dx, dy) => (dy < -0.2 ? "S4" : "S3")); p.set(2, 8, "S4"); p.set(7, 8, "S4"); p.set(2, 7, "EW"); p.set(7, 7, "EW");
  p.set(2, 8, "K"); p.set(7, 8, "K"); p.rect(3, 6, 4, 1, "Y2"); p.rect(4, 5, 2, 1, "V"); p.rect(4, 12, 2, 1, "S2");
}, 5);
candle(6, "Star votive", (p) => { // teal glass votive with star facets
  p.rect(2, 7, 6, 7, "W4"); p.rect(3, 8, 4, 5, "W5"); p.set(4, 10, "F"); p.set(5, 9, "L2"); p.set(5, 11, "L2");
  p.rect(2, 7, 6, 1, "L2"); p.rect(2, 14, 6, 1, "W2"); p.rect(4, 8, 2, 2, "V");
}, 8);

// ---------- flame frames: 7x10, wick at bottom centre (3,9) ----------
const FL = [
  ["...F...", "...F...", "..FY5..", "..Y5Y5.", ".Y4FY4.", ".Y4FY4.", ".Y3Y5Y3", ".Y3Y4Y3", "..Y2Y3.", "...Y2.."],
  ["....F..", "...F...", "...Y5..", "..Y5F..", "..Y4FY4", ".Y4FY4.", ".Y3Y5Y3", ".Y3Y4Y3", "..Y2Y3.", "...Y2.."],
  [".......", "...F...", "...F...", "..Y5Y5.", "..Y4FY4", ".Y4FY4.", ".Y3Y5Y3", ".Y3Y4Y3", "..Y2Y3.", "...Y2.."],
  ["..F....", "...F...", "..Y5...", "..Y5Y5.", ".Y4FY4.", ".Y4FY4.", ".Y3Y5Y3", ".Y3Y4Y3", "..Y2Y3.", "...Y2.."],
];
const tok = (row) => row.match(/Y\d|F|\./g);
FL.forEach((rows, f) => {
  const p = new Pix(7, 10);
  rows.forEach((r, y) => { let x = 0; for (const t of tok(r)) { if (t !== ".") p.set(x, y, t); x++; } });
  save(`flame-${f}`, p);
});
// stepped glow (pixel bands) 24x24, colour only; alpha is applied at draw time
{ const p = new Pix(24, 24); p.oval(11.5, 11.5, 12, 12, "Y2"); p.oval(11.5, 11.5, 8, 8, "Y3"); p.oval(11.5, 11.5, 4.5, 4.5, "Y4"); save("glow", p); }

// ---------- props ----------
{ // decorative lamp: iron post with a GREEN glass lantern (never warm gold, so never read as a candle)
  const p = new Pix(9, 26);
  p.rect(1, 0, 7, 1, "I1"); p.rect(2, 1, 5, 1, "S2"); p.rect(1, 2, 1, 7, "I1"); p.rect(7, 2, 1, 7, "I1");
  p.rect(2, 2, 5, 7, "L1"); p.rect(3, 3, 3, 5, "L2"); p.rect(4, 2, 1, 7, "I1"); p.rect(1, 9, 7, 1, "I1");
  p.rect(4, 10, 1, 13, "I1"); p.rect(3, 10, 1, 13, "S2"); p.rect(2, 23, 5, 2, "S3"); p.rect(2, 23, 5, 1, "S4");
  p.outline(); save("lamp", p);
}
{ // stone arch with ivy, 36x44
  const p = new Pix(36, 44);
  p.rect(2, 12, 7, 30, "S3"); p.rect(27, 12, 7, 30, "S3"); p.rect(2, 12, 2, 30, "S4"); p.rect(27, 12, 2, 30, "S4");
  for (let y = 14; y < 42; y += 4) { p.rect(2, y, 7, 1, "S1"); p.rect(27, y, 7, 1, "S1"); }
  for (let a = 0; a <= Math.PI; a += 0.02) for (let r = 11; r <= 16; r++) p.set(18 - Math.cos(a) * r, 13 - Math.sin(a) * r * 0.85, r === 16 ? "S2" : r === 11 ? "S4" : "S3");
  for (let a = 0.15; a < Math.PI; a += 0.3) for (let r = 11; r <= 16; r++) p.set(18 - Math.cos(a) * r, 13 - Math.sin(a) * r * 0.85, "S1");
  p.rect(1, 40, 9, 3, "S2"); p.rect(26, 40, 9, 3, "S2");
  seed = 3; for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI, r = 14 + rnd() * 4; const x = 18 - Math.cos(a) * r, y = 13 - Math.sin(a) * r * 0.85; p.set(x, y, rnd() < 0.5 ? "G3" : "G4"); if (rnd() < 0.25) for (let k = 1; k < 2 + rnd() * 8; k++) p.set(x, y + k, k % 3 ? "G3" : "G2"); if (rnd() < 0.12) p.set(x, y - 1, "FL"); }
  p.outline(); save("arch", p);
}
function foliage(p, cx, cy, rx, ry, dark = "G1", mid = "G2", lit = "G3", hi = "G4") {
  p.oval(cx, cy, rx, ry, (dx, dy, x, y) => { const l = -dx * 0.6 - dy * 0.8 + (gnoise[(x * 7 + y * 13) & 255] - 0.5) * 0.7; return l > 0.75 ? hi : l > 0.2 ? lit : l > -0.4 ? mid : dark; });
}
{ // weeping willow, 44x52
  const p = new Pix(44, 52);
  p.rect(20, 30, 4, 20, "B1"); p.rect(21, 30, 1, 20, "B2"); p.rect(17, 49, 10, 2, "B1");
  foliage(p, 22, 16, 18, 13);
  seed = 21; for (let i = 0; i < 46; i++) { const x = 4 + Math.round(rnd() * 36), y0 = 12 + Math.round(rnd() * 10), len = 10 + Math.round(rnd() * 26); for (let k = 0; k < len; k++) p.set(x + (k > len / 2 ? 0 : 0), y0 + k, k > len - 3 ? "G4" : (x + k) % 4 ? "G3" : "G2"); }
  p.outline("D1"); save("willow", p);
}
{ // round oak, 34x40
  const p = new Pix(34, 40); p.rect(15, 24, 4, 14, "B1"); p.rect(16, 24, 1, 14, "B2");
  foliage(p, 12, 16, 10, 9); foliage(p, 22, 14, 11, 10); foliage(p, 17, 8, 10, 7); p.outline("D1"); save("tree", p);
}
{ // cypress spire 12x38
  const p = new Pix(12, 38); p.rect(5, 33, 2, 4, "B1");
  for (let y = 0; y < 34; y++) { const w = Math.round(1 + 4.5 * Math.sin(Math.PI * Math.min(1, (y + 2) / 30)) ** 0.7); for (let x = 6 - w; x < 6 + w; x++) p.set(x, y, x < 5 ? ((x + y) % 3 ? "G3" : "G4") : (x + y) % 4 ? "G1" : "G2"); }
  p.outline("D1"); save("cypress", p);
}
{ const p = new Pix(18, 11); foliage(p, 9, 6, 8, 5); p.outline("D1"); save("bush", p); }
{ // flowering bush with white blossoms
  const p = new Pix(18, 11); foliage(p, 9, 6, 8, 5); seed = 5;
  for (let i = 0; i < 9; i++) { const x = 3 + Math.round(rnd() * 12), y = 2 + Math.round(rnd() * 6); p.set(x, y, "FL"); p.set(x + 1, y, "FL"); p.set(x, y + 1, "V2"); if (i % 3 === 0) p.set(x + 1, y + 1, "FC"); }
  p.outline("D1"); save("bush-flower", p);
}
{ // clump of white flowers, 10x7
  const p = new Pix(10, 7); p.rect(1, 5, 8, 2, "G2"); p.set(2, 4, "G3"); p.set(6, 4, "G3");
  for (const [x, y] of [[1, 2], [4, 1], [7, 2], [5, 3]]) { p.set(x, y, "FL"); p.set(x + 1, y, "FL"); p.set(x, y + 1, "FL"); p.set(x + 1, y + 1, "FC"); }
  save("flowers", p);
}
{ const p = new Pix(8, 4); p.oval(3.5, 1.5, 4, 2, "G3"); p.set(4, 1, "G1"); p.set(1, 1, "G4"); save("lilypad", p); }
{ const p = new Pix(8, 4); p.oval(3.5, 1.5, 4, 2, "G3"); p.set(3, 0, "FL"); p.set(4, 0, "FL"); p.set(3, 1, "FC"); save("lilypad-flower", p); }
{ // hanging vine strand 4x16
  const p = new Pix(4, 16); for (let y = 0; y < 16; y++) { p.set(1 + (y % 5 === 0 ? 1 : 0), y, y % 3 ? "G3" : "G4"); if (y % 4 === 2) p.set(2, y, "G2"); } save("vine", p);
}
{ // mossy boulder 14x9
  const p = new Pix(14, 9); p.oval(7, 5, 6.5, 4, (dx, dy) => (dy < -0.5 ? (dx < 0.2 ? "G3" : "G2") : dx < -0.3 ? "S4" : dy > 0.5 ? "S2" : "S3")); p.outline(); save("rock", p);
}
// ---------- frogs (original round-eyed garden frogs) ----------
function frogHead(p, x, y, flip = false) {
  // head 12x7: two big eyes on top, wide smiling mouth
  p.oval(x + 6, y + 4, 6, 3.4, (dx, dy) => (dy < -0.2 && dx < 0.3 ? "R3" : "R2"));
  p.oval(x + 3, y + 1.5, 2.6, 2.2, "R2"); p.oval(x + 9, y + 1.5, 2.6, 2.2, "R2");
  p.rect(x + 2, y + 1, 3, 2, "EW"); p.rect(x + 8, y + 1, 3, 2, "EW");
  p.set(x + (flip ? 2 : 4), y + 2, "K"); p.set(x + (flip ? 8 : 10), y + 2, "K");
  p.rect(x + 2, y + 6, 9, 1, "LP"); p.rect(x + 3, y + 5, 7, 1, "R1");
}
{ // frog reading the IMD paper on a bench, 30x24
  const p = new Pix(30, 24);
  p.rect(0, 13, 30, 2, "B2"); p.rect(0, 13, 30, 1, "B3"); p.rect(1, 6, 2, 9, "B2"); p.rect(27, 6, 2, 9, "B2"); p.rect(1, 6, 28, 2, "B2");
  p.rect(2, 15, 2, 7, "B1"); p.rect(26, 15, 2, 7, "B1");
  frogHead(p, 6, 3); p.rect(7, 10, 10, 4, "C2"); p.rect(7, 13, 14, 3, "C1"); p.rect(19, 16, 2, 5, "C1"); p.rect(19, 21, 3, 1, "R1");
  p.rect(15, 5, 10, 8, "V"); p.rect(15, 5, 10, 1, "V2"); p.map(16, 7, ["KK.K.KK", ".......", "S3S3S3S3S3S3S3"].slice(0, 0), {});
  for (const [x, y] of [[16, 7], [18, 7], [19, 7], [20, 7], [22, 7], [23, 7]]) p.set(x, y, "K");
  for (let x = 16; x < 24; x++) { p.set(x, 9, "S3"); if (x % 2) p.set(x, 11, "S3"); }
  p.rect(14, 8, 2, 2, "R2"); p.outline(); save("frog-reader", p);
}
{ // hooded wanderer frog carrying a green garden lantern, 16x24
  const p = new Pix(16, 24);
  p.oval(7, 5, 6, 5, "H1"); p.rect(2, 8, 11, 14, "H2"); p.rect(2, 8, 2, 14, "H1"); p.rect(4, 22, 3, 2, "R1"); p.rect(9, 22, 3, 2, "R1");
  p.oval(7, 7, 4, 2.6, "R2"); p.rect(4, 6, 2, 2, "EW"); p.rect(8, 6, 2, 2, "EW"); p.set(5, 7, "K"); p.set(9, 7, "K"); p.rect(5, 9, 5, 1, "LP");
  p.rect(13, 12, 1, 3, "I1"); p.rect(12, 15, 3, 4, "L1"); p.set(13, 16, "L2"); p.rect(12, 19, 3, 1, "I1"); p.rect(11, 13, 2, 2, "R2");
  p.outline(); save("frog-wanderer", p);
}
{ // gardener frog in a straw hat with watering can, 22x20
  const p = new Pix(22, 20);
  p.rect(1, 3, 16, 2, "T2"); p.rect(4, 0, 10, 3, "T3"); p.rect(4, 2, 10, 1, "T1");
  frogHead(p, 3, 4, true); p.rect(4, 11, 10, 7, "C2"); p.rect(5, 11, 2, 7, "C1"); p.rect(11, 11, 2, 7, "C1"); p.rect(3, 18, 4, 2, "R1"); p.rect(11, 18, 4, 2, "R1");
  p.rect(15, 12, 5, 4, "S4"); p.rect(15, 12, 5, 1, "S5"); p.rect(20, 11, 2, 1, "S4"); p.set(21, 10, "S4"); p.rect(13, 13, 2, 2, "R2");
  p.outline(); save("frog-gardener", p);
}
{ // frog sitting on a stone, 16x14
  const p = new Pix(16, 14); p.rect(1, 10, 14, 4, "S3"); p.rect(1, 10, 14, 1, "S4");
  frogHead(p, 2, 1); p.oval(8, 8, 5, 3, "R2"); p.rect(4, 9, 2, 2, "R1"); p.rect(10, 9, 2, 2, "R1"); p.rect(6, 7, 4, 3, "LP");
  p.outline(); save("frog-sitter", p);
}
writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ unit: "1 image pixel = 1 art pixel = 2 world units", palette: P, candles: CANDLES, files }, null, 1));
const sheetAt = process.argv.indexOf("--sheet");
if (sheetAt > 0) { // contact sheet for review (scaled 5x), written outside the site
  const Z = 5, W = 900; let x = 0, y = 0, rowH = 0; const pos = [];
  for (const p of all) { if (x + p.w * Z > W) { x = 0; y += rowH + 6; rowH = 0; } pos.push([x, y]); x += p.w * Z + 6; rowH = Math.max(rowH, p.h * Z); }
  const s = new Pix(W, y + rowH); s.rect(0, 0, W, y + rowH, "D2");
  all.forEach((p, k) => { for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) { const o = (j * p.w + i) * 4; if (!p.d[o + 3]) continue; const hex = "#" + [0, 1, 2].map((c) => p.d[o + c].toString(16).padStart(2, "0")).join(""); for (let b = 0; b < Z; b++) for (let a = 0; a < Z; a++) s.set(pos[k][0] + i * Z + a, pos[k][1] + j * Z + b, hex); } });
  writeFileSync(process.argv[sheetAt + 1], s.png());
}
console.log(files.join("\n"));
