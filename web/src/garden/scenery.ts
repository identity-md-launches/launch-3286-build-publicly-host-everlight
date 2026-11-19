import {
  HORIZON_CUT, horizonY, SECTOR_H, SECTOR_MARGIN, SECTOR_W, TILT, mulberry, hash2, pathY, sectorAt, sectorPlan, streamX, type SectorPlan, type Terrace,
} from "./layout";

/**
 * Pixel scenery of one grid cell, painted at the garden's single art resolution: 1 art pixel = PX world units.
 * Everything is either a palette tile sampled per pixel (ground, path, water, walls) or a pixel sprite from
 * public/art/px drawn at integer art-pixel positions, so the whole garden has one pixel density.
 */
export const PX = 2;
/** Overdraw of the flat layer past its own cell, in world units (whole art pixels). */
export const BASE_PAD = 4;

export interface Sheet {
  img: Record<string, HTMLImageElement | null>;
  /** tile pixels (16x16 RGBA) for per-pixel ground sampling */
  tiles: Record<string, Uint8ClampedArray | null>;
}

/** Stream head in a home-row column: a spring well below the skyline, never a cut at the cell's top edge. */
export function springY(gx: number): number {
  let y = HORIZON_CUT + 60;
  for (let i = 0; i < 5; i++) y = horizonY(streamX(gx, y)) + 95;
  return Math.round(y);
}

const snap = (v: number) => Math.round(v / PX) * PX;
export const streamHalf = (y: number) => 26 + 6 * Math.sin(y / 90);
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (X: number, Y: number, t: number) => B4[(Y & 3) * 4 + (X & 3)] / 16 < t;

/** All pools that can reach into a cell: its own and those of its vertical neighbours. */
function poolsNear(gx: number, gy: number) {
  const pools: SectorPlan["pools"] = [];
  for (const dy of [-1, 0, 1]) { const s = sectorAt(gx, gy + dy); if (s >= 0) pools.push(...sectorPlan(s).pools); }
  return pools;
}

/**
 * Flat layer: per-pixel terrain for exactly this cell (plus BASE_PAD). Every value is a function of world
 * position only, so streams, paths and tiles continue across cell joins without seams.
 */
export function drawSectorBase(g: CanvasRenderingContext2D, index: number, sheet: Sheet, wild = false) {
  const plan = sectorPlan(index);
  const { gx, gy, ox, oy } = plan;
  const w = g.canvas.width, h = g.canvas.height;
  const img = g.createImageData(w, h);
  const d = img.data;
  const T = sheet.tiles;
  const grass = T["tile-grass"], dark = T["tile-grass-dark"], path = T["tile-path"], water = T["tile-water-0"], moss = T["tile-moss-stone"];
  const spring = gy === 0 ? springY(gx) : -Infinity;
  const pools = poolsNear(gx, gy);
  const X0 = Math.round((ox - BASE_PAD) / PX), Y0 = Math.round((oy - BASE_PAD) / PX);
  const put = (o: number, t: Uint8ClampedArray | null, X: number, Y: number, fb: [number, number, number], shade = 1) => {
    const ti = ((Y & 15) * 16 + (X & 15)) * 4;
    d[o] = (t ? t[ti] : fb[0]) * shade; d[o + 1] = (t ? t[ti + 1] : fb[1]) * shade; d[o + 2] = (t ? t[ti + 2] : fb[2]) * shade; d[o + 3] = 255;
  };
  for (let j = 0; j < h; j++) {
    const Y = Y0 + j, y = Y * PX + 1;
    const sx = streamX(gx, y), hw = streamHalf(y);
    const hasStream = y > spring;
    for (let i = 0; i < w; i++) {
      const X = X0 + i, x = X * PX + 1, o = (j * w + i) * 4;
      if (gy === 0 && y < horizonY(x)) continue; // sky shows through above the skyline
      const ds = hasStream ? Math.abs(x - sx) : Infinity;
      let pool = Infinity;
      for (const p of pools) { const q = ((x - p.x) / p.rx) ** 2 + ((y - p.y) / (p.rx * TILT)) ** 2; if (q < pool) pool = q; }
      if (ds < hw || pool < 1) { put(o, water, X + (Y >> 2), Y, [18, 105, 91], ds < hw - 8 || pool < 0.7 ? 1 : 0.8); continue; }
      if (ds < hw + 6 || pool < 1.18) { put(o, moss, X, Y, [63, 122, 60]); continue; }
      const dp = Math.abs(y - pathY(gy, x));
      if (dp < 20) { put(o, path, X, Y, [100, 100, 83], 0.85); continue; }
      if (dp < 24) { put(o, dither(X, Y, 0.5) ? moss : dark, X, Y, [42, 82, 51]); continue; }
      // grass: two tiles mixed by a slow world-space field with ordered dithering; wild woodland is darker
      const f = 0.5 + 0.25 * Math.sin(x / 173 + y / 97) + 0.25 * Math.sin(x / 61 - y / 133) - (wild ? 0.35 : 0);
      const horizonFade = gy === 0 ? Math.max(0, 1 - (y - horizonY(x)) / 160) : 0;
      put(o, dither(X, Y, f) ? grass : dark, X, Y, [28, 58, 38], 1 - 0.45 * horizonFade);
    }
  }
  g.putImageData(img, 0, 0);
}

type Item = { y: number; draw: () => void };

/** Upright layer: terraces, holders, trees, arches, bridge, lamps and frogs, depth-sorted, at whole art pixels. */
export function drawSectorUpright(g: CanvasRenderingContext2D, index: number, sheet: Sheet, wild = false) {
  const plan = sectorPlan(index);
  const { gx, gy, ox, oy } = plan;
  const M = SECTOR_MARGIN, W = SECTOR_W, H = SECTOR_H;
  const r = mulberry(5000 + index * 31);
  const im = sheet.img;
  g.imageSmoothingEnabled = false;
  g.save();
  g.scale(1 / PX, 1 / PX);
  g.translate(M - ox, M - oy);
  const pattern = (n: string) => {
    const t = im[n];
    if (!t) return null;
    const p = g.createPattern(t, "repeat");
    p?.setTransform(new DOMMatrix().scale(PX));
    return p;
  };
  const wallPat = pattern("tile-wall"), lawnPat = pattern("tile-grass"), pathPat = pattern("tile-path");
  /** sprite with its bottom-centre at (x, yBase), 1 sprite pixel = 1 art pixel */
  const put = (n: string, x: number, yBase: number, flip = false) => {
    const s = im[n];
    if (!s) return;
    const w = s.width * PX, h = s.height * PX;
    const left = snap(x - w / 2), top = snap(yBase) - h;
    if (flip) { g.save(); g.translate(left + w, top); g.scale(-1, 1); g.drawImage(s, 0, 0, w, h); g.restore(); }
    else g.drawImage(s, left, top, w, h);
  };
  const hOf = (n: string) => (im[n]?.height ?? 20) * PX;
  const top = oy + (gy > 0 ? 0 : HORIZON_CUT);
  const fits = (y: number, h: number) => y - h > oy - M + 6 && y < oy + H + M - 6;

  if (gy === 0) {
    // home row: a tree line along the skyline, each tree whole
    for (let x = ox + 6 + r() * 20; x < ox + W - 6; x += 18 + r() * 26) {
      const n = r() < 0.4 ? "cypress" : r() < 0.6 ? "willow" : "tree";
      put(n, x, oy + horizonY(x) + 12 + r() * 14, r() < 0.5);
    }
  }
  const items: Item[] = [];
  const stairs = wild ? { terraces: [], gazebo: null } : stairsOf(plan);
  // ground first: flagstone walks from stair feet to the path
  for (const st of stairs.terraces) if (st.walk) drawWalk(g, st.walk, pathPat);
  if (stairs.gazebo?.stair?.walk) drawWalk(g, stairs.gazebo.stair.walk, pathPat);
  if (stairs.gazebo?.back) drawWalk(g, stairs.gazebo.back, pathPat);
  const stairOf = new Map(stairs.terraces.map((st) => [st.terrace, st] as const));
  if (!wild) plan.terraces.forEach((t, ti) => items.push({ y: t.cy + t.rx * TILT, draw: () => drawTerrace(g, t, plan.slots, im, wallPat, lawnPat, pathPat, put, r, stairOf.get(ti)) }));
  const onStairs = (x: number, y: number, rad: number) => {
    const all = stairs.gazebo?.stair ? [...stairs.terraces, stairs.gazebo.stair] : stairs.terraces;
    for (const st of all) {
      if (Math.abs(x - st.x) < st.halfW + rad * 0.5 + 8 && y > st.yTop - 6 && y - rad * 0.9 < st.yTop + st.drop + 6) return true;
      for (const w of [st.walk, st === stairs.gazebo?.stair ? stairs.gazebo.back : null]) {
        if (!w) continue;
        const [x0, y0, x1, y1] = w, lo = Math.min(y0, y1), hi = Math.max(y0, y1);
        if (y > lo - 4 && y - rad * 0.9 < hi + 4) {
          const k = hi === lo ? 0 : (y - y0) / (y1 - y0), wx = x0 + (x1 - x0) * Math.max(0, Math.min(1, k));
          if (Math.abs(x - wx) < WALK_HALF + rad * 0.5 + 6) return true;
        }
      }
    }
    return false;
  };
  const spring = gy === 0 ? springY(gx) : -Infinity;
  const clear = (x: number, y: number, rad: number) => {
    if (Math.abs(x - streamX(gx, y)) < 50 + rad * 0.4 || Math.abs(y - pathY(gy, x)) < 36) return false;
    if (y < top + 30 || x < ox - 40 || x > ox + W + 40 || y > oy + H + 40) return false;
    if (gy === 0 && Math.abs(x - streamX(gx, spring)) < 90 && y < spring + 30 && y > spring - 60) return false;
    if (!wild) for (const s of plan.slots) if (Math.abs(s[0] - x) < rad && s[1] - y < rad * 0.9 && s[1] - y > -rad * 0.25) return false;
    if (!wild && plan.gazebo && Math.hypot(plan.gazebo.x - x, plan.gazebo.y - y) < 100) return false;
    if (!wild && onStairs(x, y, rad)) return false;
    return true;
  };
  for (let i = 0, placed = 0; i < (wild ? 700 : 260) && placed < (wild ? 70 : 22); i++) {
    const x = ox - 30 + r() * (W + 60), y = oy + r() * H;
    const n = r() < 0.35 ? "willow" : r() < 0.55 ? "cypress" : "tree";
    const h = hOf(n);
    if (wild && y - oy < 120) continue; // low growth along a wild cell's north edge keeps the garden row behind visible
    if (!fits(y + 6, h) || !clear(x, y, h * 0.4)) continue;
    placed++;
    const flip = r() < 0.5;
    items.push({ y, draw: () => put(n, x, y + 4, flip) });
  }
  for (let i = 0, placed = 0; i < (wild ? 900 : 400) && placed < (wild ? 160 : 90); i++) {
    const x = ox - 20 + r() * (W + 40), y = oy + r() * H;
    if (!fits(y + 4, 24) || !clear(x, y, 24)) continue;
    placed++;
    const v = r(), n = v < 0.35 ? "bush-flower" : v < 0.6 ? "bush" : v < 0.85 ? "flowers" : "rock", flip = r() < 0.5;
    items.push({ y, draw: () => put(n, x, y + 4, flip) });
  }
  // lily pads and water flowers on the pools and stream
  for (const p of plan.pools) for (let k = 0; k < 5; k++) {
    const a = r() * Math.PI * 2, q = 0.3 + r() * 0.5;
    const x = p.x + Math.cos(a) * p.rx * q, y = p.y + Math.sin(a) * p.rx * TILT * q;
    items.push({ y: y - 400, draw: () => put(r() < 0.4 ? "lilypad-flower" : "lilypad", x, y) });
  }
  if (plan.gazebo && !wild) {
    // a ruined colonnade: two arches on a mossy plinth, draped with vines
    const { x, y } = plan.gazebo;
    // the arches stand on a raised flagstone plinth; a central flight leads down toward the path
    const gs = stairs.gazebo!;
    items.push({ y, draw: () => {
      drawPlinth(g, x, y, wallPat, pathPat);
      put("arch", x - 34, y + 4); put("arch", x + 34, y + 4, true); put("vine", x - 52, y - 54); put("vine", x + 18, y - 58);
      if (gs.stair) drawStair(g, gs.stair, wallPat, pathPat);
      put("flowers", x - 40, y + 26); put("flowers", x + 40, y + 26);
    } });
  }
  {
    const b = plan.bridge;
    items.push({ y: b.y + 20, draw: () => drawBridge(g, b, gy, pathPat, wallPat, im, put, wild) });
  }
  // frogs: on the founding sector, a reader on a bench and a gardener near the first candle; elsewhere a few wanderers
  const frogs: [string, number, number][] = [];
  if (plan.hero && !wild) { frogs.push(["frog-reader", plan.hero.x - 200, plan.hero.y - 40]); frogs.push(["frog-gardener", plan.hero.x - 120, plan.hero.y + 70]); }
  else if (!wild && hash2(gx, gy, 9) < 0.55) {
    for (let i = 0; i < 40; i++) {
      const x = ox + 80 + r() * (W - 160), y = pathY(gy, x) + (r() < 0.5 ? -38 : 44);
      if (clear(x, y, 30)) { frogs.push([hash2(gx, gy, 10) < 0.5 ? "frog-wanderer" : "frog-sitter", x, y]); break; }
    }
  }
  frogs.forEach(([n, x, y], i) => items.push({ y, draw: () => put(n, x, y, i % 2 === 1) }));
  items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());
  g.restore();
}

function drawBridge(
  g: CanvasRenderingContext2D, b: SectorPlan["bridge"], gy: number, pathPat: CanvasPattern | null, wallPat: CanvasPattern | null,
  im: Sheet["img"], put: (n: string, x: number, y: number, flip?: boolean) => void, wild: boolean,
) {
  const half = 90, deck = 20;
  for (let x = snap(b.x - half); x <= b.x + half; x += PX) {
    const y = snap(pathY(gy, x)), dx = (x - b.x) / 58;
    // deck: flagstones continuous with the path
    g.fillStyle = pathPat ?? "#646453"; g.fillRect(x, y - deck, PX, deck * 2);
    // front face with a round arch opening over the water
    const face = 34, open = Math.abs(dx) < 1 ? Math.round((26 * Math.sqrt(1 - dx * dx)) / PX) * PX : 0;
    g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(x, y + deck, PX, face - open);
    g.fillStyle = "#262824"; if (open) g.fillRect(x, y + deck + face - open - PX, PX, PX);
    // parapets: rail with posts
    const post = Math.round((x - b.x) / PX) % 8 === 0;
    g.fillStyle = "#8f8b74"; g.fillRect(x, y + deck - (post ? 12 : 8), PX, post ? 12 : PX);
    g.fillStyle = "#c4bb98"; g.fillRect(x, y + deck - (post ? 12 : 8), PX, PX);
    g.fillStyle = "#646453"; g.fillRect(x, y - deck - (post ? 8 : 6), PX, post ? 8 : PX);
  }
  // decorative lamps at the bridge heads: green glass on iron posts, steady, never a candle
  if (!wild) for (const side of [-1, 1]) put("lamp", b.x + side * (half + 6), pathY(gy, b.x + side * (half + 6)) + deck + 2);
  void im;
}

function drawTerrace(
  g: CanvasRenderingContext2D, t: Terrace, slots: [number, number, number][], im: Sheet["img"],
  wallPat: CanvasPattern | null, lawnPat: CanvasPattern | null, pathPat: CanvasPattern | null,
  put: (n: string, x: number, y: number, flip?: boolean) => void, r: () => number, stair?: Stair,
) {
  if (t.rx > 0) {
    const pad = 0.16, depth = 46 * t.scale, R = t.rx + 16 * t.scale;
    const cols = new Map<number, { yo: number; yi: number }>();
    // the wall runs on past the end that carries a flight of steps, so the flight meets its coping
    const a0 = t.a0 - (stair?.end === 0 ? Math.max(pad, stair.pad) : pad), a1 = t.a1 + (stair?.end === 1 ? Math.max(pad, stair.pad) : pad);
    for (let a = a0; a <= a1; a += 0.5 / R) {
      const X = snap(t.cx + Math.cos(a) * R);
      const yo = snap(t.cy + Math.sin(a) * R * TILT), yi = snap(t.cy + Math.sin(a) * (R - depth) * TILT);
      const c = cols.get(X);
      if (!c || yo > c.yo) cols.set(X, { yo, yi: Math.min(yi, yo - 6) });
    }
    const wall = snap(t.wall);
    for (const [X, { yo, yi }] of cols) {
      g.fillStyle = lawnPat ?? "#1c3a26"; g.fillRect(X, yi, PX, yo - yi);
      g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(X, yo, PX, wall);
      g.fillStyle = "#050a08"; g.fillRect(X, yo + wall, PX, PX); // foot shadow line
      g.fillStyle = (X / PX) % 7 === 0 ? "#a7d36a" : "#6aa84f"; g.fillRect(X, yo - PX, PX, PX); // mossy coping
      g.fillStyle = "#c4bb98"; g.fillRect(X, yo, PX, PX);
      if (hash2(X, yo, 3) < 0.09) { g.fillStyle = "#3f7a3c"; g.fillRect(X, yo + PX, PX, snap(4 + hash2(X, 1, 4) * (wall - 4))); } // hanging moss
    }
    // white flowers at the wall foot and shrubs on the lawn behind the holders
    const keys = [...cols.keys()];
    for (let k = 0; k < Math.max(1, t.count / 5); k++) { const X = keys[(r() * keys.length) | 0]; const c = cols.get(X)!; put("flowers", X, c.yo + wall + 8); }
    for (let k = 0; k < Math.max(1, t.count / 6); k++) { const X = keys[(r() * keys.length) | 0]; const c = cols.get(X)!; put(r() < 0.5 ? "bush" : "bush-flower", X, c.yi + 4, r() < 0.5); }
    if (stair) drawStair(g, stair, wallPat, pathPat);
  }
  const mine = slots.slice(t.first, t.first + t.count).sort((a, b) => a[1] - b[1]);
  for (const [x, y, k] of mine) put(k > 1.5 ? "pedestal-hero" : "holder", x, y + 2);
  void im;
}


/** A flight of steps standing in front of a retaining wall or plinth: coping at yTop, foot at yTop + drop. */
export interface Stair { x: number; yTop: number; drop: number; halfW: number; walk: [number, number, number, number] | null; terrace: number; pad: number; end: 0 | 1 }

const STAIR_HALF = 10;
const WALK_HALF = 12;
/** What a slot's holder, candle and flame cover on screen (world units), so stairs and walks keep off it. */
const slotBox = (s: [number, number, number]) => ({ l: s[0] - 14, r: s[0] + 14, t: s[1] - 84 * s[2], b: s[1] + 6 });
const boxHit = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

function wet(plan: SectorPlan, x: number, y: number, half: number) {
  const spring = plan.gy === 0 ? springY(plan.gx) : -Infinity;
  if (y > spring - 20 && Math.abs(x - streamX(plan.gx, y)) < streamHalf(y) + 10 + half) return true;
  for (const p of poolsNear(plan.gx, plan.gy)) if (((x - p.x) / (p.rx + half)) ** 2 + ((y - p.y) / ((p.rx + half) * TILT)) ** 2 < 1.3) return true;
  return false;
}

/** A flagstone walk from (x0, y0) to (x1, y1) that touches no slot box and no water. */
function walkClear(plan: SectorPlan, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    if (i > 1 && i < n - 1 && wet(plan, x, y, WALK_HALF)) return false;
    const box = { l: x - WALK_HALF - 4, r: x + WALK_HALF + 4, t: y - 6, b: y + 6 };
    for (const s of plan.slots) if (boxHit(box, slotBox(s))) return false;
  }
  return true;
}

/**
 * Walk from a stair foot to the row's path, if one fits within reach: straight down to a path in front, or, for a
 * terrace standing in front of the path, from the path past the terrace's end (`side`) to the foot of its steps.
 */
function walkToPath(plan: SectorPlan, x: number, y: number, reach: number, side = 0, halfW = 0): Stair["walk"] {
  for (const dx of [0, -36, 36, -72, 72]) {
    const px = x + dx, py = pathY(plan.gy, px) - 14;
    if (py - y < 6 || py - y > reach) continue;
    if (walkClear(plan, x, y, px, py)) return [x, y, px, py];
  }
  if (side) {
    const wx = x + side * (halfW + WALK_HALF + 6), py = pathY(plan.gy, wx) + 14;
    if (y - py > 6 && y - py < reach && walkClear(plan, wx, py, wx, y - 4)) return [wx, py, x, y];
  }
  return null;
}

const stairCache = new Map<number, { terraces: Stair[]; gazebo: { stair: Stair | null; back: [number, number, number, number] | null } | null }>();

/**
 * Stairs of a sector, from its plan alone (no slot moves): a flight at one end of every terrace long enough to
 * carry one, past its last holder and on the front-facing part of the wall, kept clear of every slot box and of
 * water; foreground flights get a walk down to the path. The twin arches stand on a plinth with a central flight
 * and a walk to the path.
 */
export function stairsOf(plan: SectorPlan) {
  const hit = stairCache.get(plan.index);
  if (hit) return hit;
  const terraces: Stair[] = [];
  plan.terraces.forEach((t, ti) => {
    if (t.rx <= 0 || t.count < 4) return;
    const R = t.rx + 16 * t.scale, step = (32 * t.scale) / t.rx, halfW = Math.round(STAIR_HALF * Math.max(0.9, t.scale));
    const wall = snap(t.wall), depth = 12;
    const ends = ([[1, t.a1 + 0.5 * step], [0, t.a0 - 0.5 * step]] as const)
      .map(([end, a]) => ({ end, a }))
      .sort((p, q) => Math.abs(p.a - Math.PI / 2) - Math.abs(q.a - Math.PI / 2));
    for (const { end, a } of ends) {
      if (Math.abs(a - Math.PI / 2) > 0.8) continue;
      const x = t.cx + Math.cos(a) * R, yTop = t.cy + Math.sin(a) * R * TILT;
      const drop = wall + depth;
      const box = { l: x - halfW - 10, r: x + halfW + 10, t: yTop - 6, b: yTop + drop + 4 };
      if (plan.slots.some((s) => boxHit(box, slotBox(s)))) continue;
      if (wet(plan, x, yTop + drop, halfW) || x < plan.ox - 20 || x > plan.ox + SECTOR_W + 20) continue;
      if (Math.abs(yTop + drop / 2 - pathY(plan.gy, x)) < 24) continue; // never a flight standing in the path
      if (plan.gazebo && Math.hypot(plan.gazebo.x - x, (plan.gazebo.y - yTop) / TILT) < 150) continue;
      const pad = 0.5 * step + (halfW + 12) / R;
      terraces.push({ x, yTop, drop, halfW, walk: walkToPath(plan, x, yTop + drop, 220, x >= t.cx ? 1 : -1, halfW), terrace: ti, pad, end });
      break;
    }
  });
  let gazebo: { stair: Stair | null; back: [number, number, number, number] | null } | null = null;
  if (plan.gazebo) {
    const { x, y } = plan.gazebo;
    // the widest flight that keeps clear of every slot box; a plain plinth front when none does
    let stair: Stair | null = null;
    for (const [drop, halfW] of [[22, 18], [16, 14], [12, 10]]) {
      const box = { l: x - halfW - 10, r: x + halfW + 10, t: y + 2, b: y + 8 + drop + 4 };
      if (!plan.slots.some((sl) => boxHit(box, slotBox(sl)))) { stair = { x, yTop: y + 8, drop, halfW, walk: null, terrace: -1, pad: 0, end: 0 }; break; }
    }
    let back: [number, number, number, number] | null = null;
    if (stair && pathY(plan.gy, x) > y) stair.walk = walkToPath(plan, x, y + 8 + stair.drop, 420);
    else for (const dx of [0, -36, 36]) {
      const py = pathY(plan.gy, x + dx) + 14;
      if (walkClear(plan, x + dx, py, x, y - 18)) { back = [x + dx, py, x, y - 18]; break; }
    }
    gazebo = { stair, back };
  }
  const out = { terraces, gazebo };
  stairCache.set(plan.index, out);
  return out;
}

/** Steps in the garden's pixel style: path-tile treads with a pale nosing, wall-tile risers, stone cheeks. */
function drawStair(g: CanvasRenderingContext2D, st: Stair, wallPat: CanvasPattern | null, pathPat: CanvasPattern | null) {
  const n = Math.max(3, Math.round(st.drop / 9));
  const yTop = snap(st.yTop), total = snap(st.drop), x0 = snap(st.x - st.halfW), x1 = snap(st.x + st.halfW);
  for (let i = 0; i < n; i++) {
    const t = yTop + snap((total * i) / n), b = yTop + snap((total * (i + 1)) / n);
    const grow = PX * Math.floor(i / 2); // a touch wider toward the viewer
    const L = x0 - grow, W = x1 - x0 + 2 * grow, tread = Math.max(PX * 2, snap((b - t) * 0.5));
    g.fillStyle = pathPat ?? "#646453"; g.fillRect(L, t, W, tread);
    g.fillStyle = "#c4bb98"; g.fillRect(L, t + tread - PX, W, PX);
    g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(L, t + tread, W, b - t - tread);
    g.fillStyle = "#14170f"; g.fillRect(L, b - PX, W, PX);
    // cheeks: low stone side walls with a moss cap
    g.fillStyle = "#2f322b"; g.fillRect(L - 2 * PX, t, 2 * PX, b - t); g.fillRect(L + W, t, 2 * PX, b - t);
    if (i === 0) { g.fillStyle = "#6aa84f"; g.fillRect(L - 2 * PX, t - PX, 2 * PX, PX); g.fillRect(L + W, t - PX, 2 * PX, PX); }
  }
  g.fillStyle = "#050a08"; g.fillRect(x0 - PX * (2 + Math.floor((n - 1) / 2)), yTop + total, x1 - x0 + 2 * PX * (2 + Math.floor((n - 1) / 2)), PX);
}

/** A flagstone walk on the ground, art-pixel stepped, with darker moss edges. */
function drawWalk(g: CanvasRenderingContext2D, w: [number, number, number, number], pathPat: CanvasPattern | null) {
  const [x0, y0, x1, y1] = w;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(y1 - y0), Math.abs(x1 - x0)) / PX));
  for (let i = 0; i <= n; i++) {
    const y = snap(y0 + ((y1 - y0) * i) / n), x = snap(x0 + ((x1 - x0) * i) / n);
    g.fillStyle = "#24402b"; g.fillRect(x - WALK_HALF - PX * 2, y, WALK_HALF * 2 + PX * 4, PX);
    g.fillStyle = pathPat ?? "#646453"; g.fillRect(x - WALK_HALF, y, WALK_HALF * 2, PX);
    if (((y / PX) & 7) === 0) { g.fillStyle = "#4b4c3f"; g.fillRect(x - WALK_HALF, y, WALK_HALF * 2, PX); } // flagstone joints
  }
}

/** Raised flagstone plinth under the twin arches: a paved top and a mossy stone front. */
function drawPlinth(g: CanvasRenderingContext2D, x: number, y: number, wallPat: CanvasPattern | null, pathPat: CanvasPattern | null) {
  const half = 84, l = snap(x - half), w = snap(half * 2);
  g.fillStyle = pathPat ?? "#646453"; g.fillRect(l, snap(y - 16), w, 24);
  g.fillStyle = "#c4bb98"; g.fillRect(l, snap(y + 8), w, PX);
  g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(l, snap(y + 8) + PX, w, 12);
  g.fillStyle = "#6aa84f"; for (let X = l; X < l + w; X += PX) if (hash2(X, y | 0, 7) < 0.3) g.fillRect(X, snap(y + 8) - PX, PX, PX);
  g.fillStyle = "#050a08"; g.fillRect(l, snap(y + 8) + PX + 12, w, PX);
}
