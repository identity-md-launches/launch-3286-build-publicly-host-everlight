import { mulberry } from "./layout";

/**
 * The distant vista in 16-bit pixel art: dithered night sky with stars, three ridges of wooded hills with
 * empty stone terraces and aqueduct arches, and ONE castle on its own hill under a pixel moon. Painted once
 * per pixel at VS (vista units per art pixel) and drawn scaled with nearest-neighbour sampling. The sky and
 * ridges tile horizontally (sums of whole periods across VISTA_W); moon, hill and castle are one image drawn
 * once. No candle-like lights are painted here: lit candles come only from contract data. Castle windows are
 * small steady ivory squares.
 */
export const VISTA_W = 2400;
export const VISTA_H = 760;
export const VISTA_TOP = "#03070a";
export const VISTA_FOOT = "#0b1712";
export const VISTA_CASTLE_X = 0.8;
export const CASTLE_W = 1100;
/** vista units per art pixel */
const VS = 4;

export interface Vista { layers: HTMLCanvasElement[]; castle: HTMLCanvasElement; castleAfter: number }

const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x: number, y: number, t: number) => B4[(y & 3) * 4 + (x & 3)] / 16 < t;
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function pix(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const set = (x: number, y: number, col: string) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const [r, gg, b] = hex(col); const o = (y * w + x) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  };
  return { c, set, done: () => g.putImageData(img, 0, 0), w, h };
}

const TAU = Math.PI * 2;
function ridge(x: number, W: number, base: number, amp: number, seed: number, harm: [number, number][]) {
  let y = base;
  for (const [k, a] of harm) y -= amp * a * Math.sin((TAU * k * x) / W + seed * k);
  return y;
}

export function makeVista(): Vista {
  const W = VISTA_W / VS, H = VISTA_H / VS;
  const r = mulberry(4242);
  // sky: banded night gradient with ordered dither between bands, plus stars
  const sky = pix(W, H);
  const bands = ["#03070a", "#06100f", "#0a1a18", "#0f2622", "#16352d"];
  for (let y = 0; y < H; y++) {
    const t = Math.min(0.999, (y / (H * 0.8)) ** 1.3) * (bands.length - 1);
    const i = Math.floor(t), f = t - i;
    for (let x = 0; x < W; x++) sky.set(x, y, dither(x, y, f) ? bands[Math.min(bands.length - 1, i + 1)] : bands[i]);
  }
  for (let i = 0; i < 160; i++) { const x = r() * W, y = r() * H * 0.55; sky.set(x, y, r() < 0.2 ? "#efe6cc" : "#6f8a86"); }
  sky.done();
  // ridges, back to front, with stepped terraces and tree crowns along the crest
  const ridges: { base: number; amp: number; body: string; rim: string; tree: string; seed: number; terr: boolean }[] = [
    { base: H * 0.6, amp: 26, body: "#0d2423", rim: "#1d4a44", tree: "#0a1c1b", seed: 1.3, terr: false },
    { base: H * 0.72, amp: 18, body: "#0f2a22", rim: "#24584a", tree: "#0b2019", seed: 2.9, terr: true },
    { base: H * 0.86, amp: 12, body: "#102419", rim: "#2a5233", tree: "#0b1712", seed: 4.1, terr: true },
  ];
  const layers = [sky.c];
  ridges.forEach((rd, li) => {
    const L = pix(W, H);
    const harm: [number, number][] = [[1, 0.5], [3, 0.3], [7, 0.15], [13, 0.06]];
    for (let x = 0; x < W; x++) {
      const top = Math.round(ridge(x, W, rd.base, rd.amp, rd.seed, harm));
      for (let y = top; y < H; y++) {
        // terraces: horizontal retaining walls every few rows on the nearer ridges
        const wall = rd.terr && (y - top) > 3 && (y + (x >> 5)) % 7 === 0;
        L.set(x, y, y === top ? rd.rim : wall ? (x % 9 === 0 ? "#06100c" : "#2c3b33") : dither(x, y, 0.15) ? rd.rim : rd.body);
      }
      // crowns of trees along the crest
      if ((x * 7 + li * 3) % 5 === 0) { const th = 2 + ((x * 13 + li) % 4); for (let k = 1; k <= th; k++) { L.set(x, top - k, rd.tree); L.set(x + 1, top - k + 1, rd.tree); } }
    }
    if (li === 1) for (let a = 0; a < 3; a++) { // aqueduct arches on the middle ridge
      const ax = Math.round(W * (0.12 + a * 0.31)), ay = Math.round(ridge(ax, W, rd.base, rd.amp, rd.seed, harm)) - 2;
      for (let x = 0; x < 34; x++) for (let y = 0; y < 10; y++) { const lx = x % 8; const hole = y > 3 && lx > 1 && lx < 7 && !(y === 4 && (lx === 2 || lx === 6)); if (!hole) L.set(ax + x, ay - 10 + y, y === 0 ? "#4a5a50" : "#2c3b33"); }
    }
    L.done();
    layers.push(L.c);
  });
  // castle image: moon, hill and castle, drawn once
  const CW = CASTLE_W / VS;
  const C = pix(CW, H);
  const mx = CW * 0.3, my = H * 0.16, mr = 11;
  for (let y = -mr - 6; y <= mr + 6; y++) for (let x = -mr - 6; x <= mr + 6; x++) {
    const d = Math.hypot(x, y);
    if (d <= mr) C.set(mx + x, my + y, (x + 3) ** 2 + (y - 2) ** 2 < 9 || (x - 4) ** 2 + (y + 4) ** 2 < 4 ? "#d9d3b4" : d > mr - 1.2 ? "#e8e2c4" : "#fbf6dc");
    else if (d <= mr + 4 && dither(x, y, 0.35)) C.set(mx + x, my + y, "#1c3a33");
  }
  const cx = CW * 0.55, hillTop = H * 0.5;
  for (let x = 0; x < CW; x++) {
    const t = (x - cx) / (CW * 0.32);
    if (Math.abs(t) > 1) continue;
    const y0 = Math.round(hillTop + (H * 0.2) * t * t);
    for (let y = y0; y < H; y++) C.set(x, y, y === y0 ? "#1d4a44" : dither(x, y, 0.2) ? "#123630" : "#0c221f");
  }
  // castle: curtain wall, keep and towers with crenellations and pointed roofs
  const body = "#0a1716", lit = "#1f3a3a";
  const block = (x0: number, w: number, top: number, roof: number) => {
    for (let x = x0; x < x0 + w; x++) for (let y = top; y < hillTop + 6; y++) C.set(x, y, x === x0 ? lit : body);
    for (let x = x0; x < x0 + w; x += 2) C.set(x, top - 1, body);
    if (roof) for (let k = 0; k < roof; k++) { const half = Math.max(0, Math.round((w / 2 + 1) * (1 - k / roof))); for (let x = -half; x <= half; x++) C.set(x0 + w / 2 + x, top - 1 - k, k % 3 ? body : lit); }
  };
  block(cx - 36, 72, hillTop - 14, 0);
  block(cx - 12, 24, hillTop - 34, 12);
  block(cx - 34, 10, hillTop - 26, 10);
  block(cx + 24, 10, hillTop - 28, 10);
  block(cx - 50, 8, hillTop - 18, 8);
  block(cx + 42, 8, hillTop - 20, 8);
  for (const [wx, wy] of [[cx - 4, hillTop - 28], [cx + 3, hillTop - 28], [cx - 30, hillTop - 20], [cx + 28, hillTop - 22], [cx - 20, hillTop - 8], [cx + 12, hillTop - 8], [cx - 1, hillTop - 18]]) {
    C.set(wx, wy, "#cdbf9c"); C.set(wx, wy + 1, "#8f8b74");
  }
  C.done();
  return { layers, castle: C.c, castleAfter: 1 };
}
