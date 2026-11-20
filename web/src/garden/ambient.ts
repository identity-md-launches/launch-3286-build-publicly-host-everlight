/**
 * Ambient garden Pepes: small decorative characters, original pixel sprites drawn in code for this garden that depict
 * Pepe (broad green face, heavy-lidded side-glancing eyes, wide two-tone lips, blue shirt)
 * that read, carry a lantern, roll in the grass, walk to trees and rest, dance, and hold a gentle light ritual.
 *
 * They are scenery, not users or agents: they never create candles, wishes, rewards or chain activity, are never
 * hit-tested (candle selection ignores them), and are drawn from one shared sprite atlas built once at start.
 * Behaviour is a pure function of (sector, actor seed, time), so off-screen sectors cost nothing (culled), a hidden
 * tab simply stops drawing, and reduced motion freezes every actor on a fixed pose at a fixed place.
 */
import { HORIZON_CUT, SECTOR_H, SECTOR_W, TILT, hash2, horizonY, mulberry, pathY, sectorPlan, streamX, type SectorPlan } from "./layout";
import { CONTOUR_WALL, PX, contourAt, springY, streamHalfAt, TREE_SPOTS } from "./scenery";

// ---------------------------------------------------------------- sprite atlas (original pixel art, built in code)
const CELL = 20;
const PAL: Record<string, string> = {
  K: "#050a08", G: "#3f7a3c", L: "#6aa84f", H: "#a7d36a", D: "#2a5233", W: "#f0efe6", P: "#050a08", B: "#cdbf9c",
  C: "#d79a32", M: "#12251b", N: "#efe6cc", T: "#646453", Y: "#d79a32", Q: "#fff2b0", R: "#9a5f1c", E: "#7dffb0", F: "#c8ffe0",
  S: "#6a4424", O: "#9a6a3a",
  // Pepe: upper and lower lip, eyelid line, shirt and its shade
  U: "#c4644c", V: "#8a3a2c", J: "#35609a", I: "#25466f", Z: "#5a9a44",
};
type Grid = (string | null)[][];
const blank = (): Grid => Array.from({ length: CELL }, () => Array<string | null>(CELL).fill(null));
const set = (g: Grid, x: number, y: number, c: string) => { if (x >= 0 && y >= 0 && x < CELL && y < CELL) g[y][x] = c; };
const rect = (g: Grid, x: number, y: number, w: number, h: number, c: string) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(g, x + i, y + j, c); };
const ell = (g: Grid, cx: number, cy: number, rx: number, ry: number, c: string) => {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      if (((x - cx) / (rx + 0.35)) ** 2 + ((y - cy) / (ry + 0.35)) ** 2 <= 1) set(g, x, y, c);
};
/** Outline: every empty pixel touching a filled one (4-neighbour) becomes the dark ink colour. */
function outline(g: Grid) {
  const o = g.map((r) => r.slice());
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    if (g[y][x]) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== "K")) o[y][x] = "K";
  }
  return o;
}

interface Pose {
  /** body bob (rows, + is down), feet offsets [left dx, left lift, right dx, right lift] */
  bob?: number; feet?: [number, number, number, number];
  /** arm ends relative to the shoulders: [dx, dy] per side; null hides the arm behind the body */
  armL?: [number, number] | null; armR?: [number, number] | null;
  eyes?: "open" | "closed" | "left" | "right" | "up" | "back";
  sit?: boolean; mouth?: "smile" | "o";
  prop?: (g: Grid, b: { cx: number; cy: number; hl: [number, number]; hr: [number, number] }) => void;
}
/**
 * One Pepe pose, facing right (flipped at draw time). Head: a broad face wider than tall with two big eyes bulging over
 * its top edge, heavy upper lids and pupils glancing to the side; wide salmon upper and dark lower lips that run past
 * the cheek on the facing side. Body: a blue shirt over short green legs and arms.
 */
function frog(p: Pose): Grid {
  const g = blank();
  const bob = p.bob ?? 0;
  const cy = (p.sit ? 12 : 10) + bob, base = 17;
  const hy = cy - 2.5; // head centre
  // feet and legs first (the shirt covers their tops)
  const [ldx, lup, rdx, rup] = p.feet ?? [0, 0, 0, 0];
  if (p.sit) { rect(g, 4, 16, 5, 1, "G"); rect(g, 11, 16, 5, 1, "G"); rect(g, 4, 17, 2, 1, "D"); rect(g, 14, 17, 2, 1, "D"); }
  else {
    rect(g, 7 + ldx, cy + 4, 2, base - (cy + 4) - lup, "G"); rect(g, 6 + ldx, base - lup, 3, 1, "D");
    rect(g, 11 + rdx, cy + 4, 2, base - (cy + 4) - rup, "G"); rect(g, 11 + rdx, base - rup, 3, 1, "D");
  }
  // shirt
  ell(g, 9.5, cy + 3.2, 3.6, 2.4, "J");
  rect(g, 7, Math.round(cy + 4.6), 6, 1, "I");
  // head: broad face, lighter crown
  ell(g, 9.5, hy, 6.2, 3.4, "G");
  for (let x = 5; x <= 14; x++) if (g[Math.round(hy - 3)]?.[x] === "G") set(g, x, Math.round(hy - 3), "Z");
  // two big eyes bulging over the top of the head
  const ey = Math.round(hy - 2);
  for (const ex of [6.5, 12.5]) {
    ell(g, ex, ey, 2.3, 1.9, "G");
    const x0 = Math.round(ex - 2);
    if (p.eyes === "back") continue;
    if (p.eyes === "closed") { rect(g, x0, ey, 4, 1, "D"); continue; }
    // whites under a heavy lid (the lid covers the top half: Pepe's half-closed look)
    rect(g, x0, ey, 4, 2, "W");
    rect(g, x0, ey - 1, 4, 1, "D");
    const look = p.eyes === "left" ? 0 : p.eyes === "up" ? 1 : 2; // default glance: to the side (facing direction)
    rect(g, x0 + look, p.eyes === "up" ? ey : ey + 1 - 1, 2, p.eyes === "up" ? 1 : 2, "P");
  }
  if (p.eyes !== "back") {
    // wide two-tone lips across the lower face, protruding past the cheek on the facing side
    const ly = Math.round(hy + 1.6);
    if (p.mouth === "o") { rect(g, 9, ly, 4, 2, "U"); rect(g, 10, ly, 2, 1, "M"); set(g, 13, ly, "U"); }
    else { rect(g, 5, ly, 11, 1, "U"); set(g, 16, ly, "U"); rect(g, 6, ly + 1, 9, 1, "V"); set(g, 15, ly + 1, "V"); }
  }
  // arms: short green limbs from the shoulders to the given hand positions
  const sy = Math.round(cy + 2);
  const sh: [number, number][] = [[6, sy], [13, sy]];
  const hands: [number, number][] = [[4, sy + 2], [15, sy + 2]];
  [p.armL, p.armR].forEach((a, i) => {
    if (a === null) return;
    const [dx, dy] = a ?? [i ? 1 : -1, 2];
    const [sx, sy0] = sh[i];
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let k = 1; k <= steps; k++) set(g, Math.round(sx + (dx * k) / steps), Math.round(sy0 + (dy * k) / steps), "L");
    hands[i] = [sx + dx, sy0 + dy];
  });
  p.prop?.(g, { cx: 9.5, cy, hl: hands[0], hr: hands[1] });
  return outline(g);
}
const paper = (fold: number) => (g: Grid, b: { cy: number }) => {
  const y = Math.round(b.cy) + 1, w = [7, 5, 3, 5][fold], x = 10 - Math.floor(w / 2);
  rect(g, x - (fold === 3 ? 2 : 0), y, w, 5, "N");
  for (let k = 0; k < w - 1; k += 2) rect(g, x + k - (fold === 3 ? 2 : 0), y + 1, 1, 3, "T");
  if (fold === 1 || fold === 2) rect(g, x + w, y - 1, 2, 4, "N"); // the page lifting over
};
const lantern = (swing: number) => (g: Grid, b: { hr: [number, number] }) => {
  const [hx, hy] = b.hr;
  set(g, hx, hy + 1, "R");
  rect(g, hx - 1 + swing, hy + 2, 3, 3, "Y"); set(g, hx + swing, hy + 3, "Q");
};
const ritualLight = (raised: boolean) => (g: Grid, b: { cy: number }) => {
  const y = Math.max(0, Math.round(b.cy) + (raised ? -10 : 2));
  rect(g, 9, y, 2, 2, "E"); set(g, 9, y, "F");
};
const bench = (g: Grid) => { rect(g, 2, 15, 16, 1, "O"); rect(g, 3, 16, 1, 2, "S"); rect(g, 16, 16, 1, 2, "S"); };

const W4: [number, number, number, number][] = [[-1, 1, 1, 0], [0, 0, 0, 0], [1, 0, -1, 1], [0, 0, 0, 0]];
const FRAMES: Record<string, Grid[]> = {
  walk: W4.map((f, i) => frog({ feet: f, bob: i % 2 ? 0 : -0, armL: [-1, i === 0 ? 1 : 2], armR: [1, i === 2 ? 1 : 2], eyes: "right" })),
  idle: [frog({}), frog({ eyes: "closed" }), frog({ eyes: "left" })],
  read: [0, 0, 1, 2, 3].map((fold, i) => frog({ sit: true, eyes: i === 1 ? "left" : i === 0 ? "right" : "open", armL: [2, 1], armR: [-2, 1], prop: (g, b) => { bench(g); paper(fold)(g, b); } })),
  lantern: W4.map((f, i) => frog({ feet: f, armL: [-1, 2], armR: [2, 1], eyes: "right", prop: lantern(i % 2 ? 1 : 0) })),
  lift: [frog({ armL: [-1, 2], armR: [2, -2], eyes: "up", prop: lantern(0) })],
  curl: [frog({ eyes: "closed", feet: [1, 2, -1, 2], armL: [1, 1], armR: [-1, 1] })],
  getup: [frog({ sit: true, eyes: "open", armL: [-2, 2], armR: [2, 2] })],
  dance: [
    frog({ armL: [-3, -3], armR: [3, -3], mouth: "o", eyes: "up" }),
    frog({ armL: [-3, 0], armR: [2, -3], feet: [0, 3, 0, 0] }),
    frog({ armL: [-2, -3], armR: [3, 0], feet: [0, 0, 0, 3] }),
    frog({ eyes: "back", armL: [-3, -1], armR: [3, -1], bob: -1 }),
    frog({ armL: [-3, 2], armR: [3, 2], bob: 1, eyes: "closed", mouth: "o" }),
  ],
  ritual: [frog({ sit: true, armL: [2, -1], armR: [-2, -1], eyes: "closed", prop: ritualLight(false) }), frog({ sit: true, armL: [2, -5], armR: [-2, -5], eyes: "up", prop: ritualLight(true) })],
  rest: [frog({ sit: true, eyes: "closed", armL: [1, 2], armR: [-1, 2] }), frog({ sit: true, eyes: "closed", bob: 1, armL: [1, 2], armR: [-1, 2] })],
};
/** Rolling: the curled frog rotated by quarter turns (pixel-exact). */
const rot = (g: Grid, q: number): Grid => {
  let o = g;
  for (let k = 0; k < q; k++) { const n = blank(); for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) n[x][CELL - 1 - y] = o[y][x]; o = n; }
  return o;
};
FRAMES.roll = [0, 1, 2, 3].map((q) => rot(FRAMES.curl[0], q));

export const FRAME_INDEX: Record<string, number> = {};
let atlas: HTMLCanvasElement | null = null;
/** One shared atlas for every actor (built once, 1 canvas pixel = 1 art pixel). */
export function frogAtlas(): HTMLCanvasElement | null {
  if (atlas || typeof document === "undefined") return atlas;
  const all = Object.entries(FRAMES).flatMap(([k, fs]) => fs.map((f, i) => [`${k}:${i}`, f] as const));
  const c = document.createElement("canvas");
  c.width = all.length * CELL; c.height = CELL;
  const g = c.getContext("2d");
  if (!g) return null;
  all.forEach(([key, grid], n) => {
    FRAME_INDEX[key] = n;
    grid.forEach((row, y) => row.forEach((col, x) => { if (col) { g.fillStyle = PAL[col]; g.fillRect(n * CELL + x, y, 1, 1); } }));
  });
  atlas = c;
  return c;
}
export const frameCount = (k: string) => FRAMES[k]?.length ?? 0;

// ---------------------------------------------------------------- actors and their behaviour
export type Activity = "reader" | "lantern" | "roller" | "walker" | "dancer" | "ritual";
export interface Actor { kind: Activity; sector: number; seed: number; x: number; y: number; flip?: boolean;
  /** walkers / lantern: waypoints [x, y, pauseMs, poseWhilePaused] */
  route?: Waypoint[]; ring?: number }
/**
 * [x, y, pauseMs, poseWhilePaused, pathOffset?]. A waypoint with a path offset sits on the winding path; a leg between
 * two such waypoints follows the path curve itself (y = pathY(x) + offset), so the feet never cut across a wall face.
 */
export type Waypoint = [number, number, number, string, number?];
export interface ActorFrame { x: number; y: number; frame: string; flip: boolean; glow?: "warm" | "mint" }

const stream = (gx: number, x: number, y: number) => {
  if (y < springY(gx) - 30) return Infinity;
  return Math.abs(x - streamX(gx, y)) - streamHalfAt(gx, y);
};
/** A ground spot is free when it keeps clear of candle slots, water, pools, the bridge, gazebo, hero and skyline. */
export function freeSpot(plan: SectorPlan, x: number, y: number, r: number, offPath = true): boolean {
  const { ox, oy, gx, gy } = plan;
  if (x < ox + 50 || x > ox + SECTOR_W - 50 || y < oy + 40 || y > oy + SECTOR_H - 30) return false;
  if (gy === 0 && y < horizonY(x) + 90) return false;
  if (y < oy + (gy === 0 ? HORIZON_CUT + 60 : 0)) return false;
  for (const dgx of [gx - 1, gx, gx + 1]) if (stream(dgx, x, y) < r * 0.6 + 12) return false;
  if (offPath && Math.abs(y - pathY(gy, x)) < 30) return false;
  // never on a hillside wall or its coping: on the level ground between two walls, clear of the drop below
  for (const dx of [-r * 0.6, 0, r * 0.6]) { const c = contourAt(x + dx, y); if (c.d > -8 - r * 0.25 && c.d < CONTOUR_WALL + 10) return false; }
  for (const dx of [-r * 0.6, 0, r * 0.6]) { const c = contourAt(x + dx, y + 12); if (c.d > -6 && c.d < CONTOUR_WALL + 6) return false; }
  for (const s of plan.slots) if (Math.abs(s[0] - x) < r + 18 && y - s[1] > -r * 0.5 - 4 && s[1] - y < 92 * s[2] + r * 0.4) return false;
  for (const p of plan.pools) if (((x - p.x) / (p.rx + r)) ** 2 + ((y - p.y) / ((p.rx + r) * TILT)) ** 2 < 1) return false;
  if (Math.hypot(x - plan.bridge.x, (y - plan.bridge.y) / TILT) < 110 + r) return false;
  if (plan.gazebo && Math.hypot(x - plan.gazebo.x, (y - plan.gazebo.y + 40) / TILT) < 120 + r) return false;
  if (plan.hero && Math.hypot(x - plan.hero.x, (y - plan.hero.y + 40) / TILT) < 160 + r) return false;
  return true;
}
/** Is the straight walk between two points dry (no water) the whole way? */
/**
 * A straight off-path leg is walkable only when every sample is dry (no stream or pool) and on level ground: a wall
 * face or its coping is crossed only inside the path's stair corridor.
 */
function walkable(plan: SectorPlan, x0: number, y0: number, x1: number, y1: number) {
  if (!dryWalk(plan, x0, y0, x1, y1)) return false;
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    const c = contourAt(x, y);
    if (c.d > -6 && c.d < CONTOUR_WALL + 6 && Math.abs(y - pathY(plan.gy, x)) > 8) return false;
  }
  return true;
}
function dryWalk(plan: SectorPlan, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 12);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    for (const dgx of [plan.gx - 1, plan.gx, plan.gx + 1]) if (stream(dgx, x, y) < 8) return false;
    for (const p of plan.pools) if (((x - p.x) / p.rx) ** 2 + ((y - p.y) / (p.rx * TILT)) ** 2 < 1.05) return false;
  }
  return true;
}
/** A dry stretch of the path inside the sector (between the bridge and the cell edges). */
function pathRun(plan: SectorPlan, r: () => number, len: number): [number, number] | null {
  for (let k = 0; k < 24; k++) {
    const a = plan.ox + 80 + r() * (SECTOR_W - 160 - len);
    if (dryWalk(plan, a, pathY(plan.gy, a), a + len, pathY(plan.gy, a + len))) {
      let ok = true;
      for (let x = a; x <= a + len && ok; x += 24) if (!freeOnPath(plan, x)) ok = false;
      if (ok) return [a, a + len];
    }
  }
  return null;
}
const freeOnPath = (plan: SectorPlan, x: number) => {
  const y = pathY(plan.gy, x);
  if (plan.gy === 0 && y < horizonY(x) + 80) return false;
  return Math.hypot(x - plan.bridge.x, (y - plan.bridge.y) / TILT) > 70 && (!plan.hero || Math.hypot(x - plan.hero.x, (y - plan.hero.y) / TILT) > 120);
};
function findSpot(plan: SectorPlan, r: () => number, rad: number, offPath = true): [number, number] | null {
  for (let k = 0; k < 200; k++) {
    const x = plan.ox + 60 + r() * (SECTOR_W - 120), y = plan.oy + 60 + r() * (SECTOR_H - 100);
    if (freeSpot(plan, x, y, rad, offPath)) return [x, y];
  }
  return null;
}

const actorCache = new Map<number, Actor[]>();
/** Modest density: at most about seven frogs per garden cell; a ritual circle in every third cell. */
export function actorsOf(index: number): Actor[] {
  const hit = actorCache.get(index);
  if (hit) return hit;
  const plan = sectorPlan(index);
  const r = mulberry(0xf20 + index * 977);
  const out: Actor[] = [];
  const near = (x: number, y: number) => out.some((a) => Math.hypot(a.x - x, (a.y - y) / TILT) < 90);
  const place = (kind: Activity, rad: number, offPath = true) => {
    for (let k = 0; k < 6; k++) { const s = findSpot(plan, r, rad, offPath); if (s && !near(s[0], s[1])) return s; }
    return null;
  };
  const seed = () => Math.floor(r() * 1e9);
  if (index % 3 === 0) { const s = place("ritual", 60); if (s) out.push({ kind: "ritual", sector: index, seed: seed(), x: s[0], y: s[1], ring: 5 }); }
  const rd = place("reader", 20); if (rd) out.push({ kind: "reader", sector: index, seed: seed(), x: rd[0], y: rd[1], flip: r() < 0.5 });
  const ro = place("roller", 50); if (ro) out.push({ kind: "roller", sector: index, seed: seed(), x: ro[0], y: ro[1] });
  const dn = place("dancer", 24); if (dn) out.push({ kind: "dancer", sector: index, seed: seed(), x: dn[0], y: dn[1] });
  const lr = pathRun(plan, r, 360 + r() * 200);
  if (lr) out.push({ kind: "lantern", sector: index, seed: seed(), x: lr[0], y: pathY(plan.gy, lr[0]), route: [[lr[0], pathY(plan.gy, lr[0]) + 2, 2600, "lift", 2], [lr[1], pathY(plan.gy, lr[1]) + 2, 1800, "lift", 2]] });
  for (let w = 0; w < 2; w++) {
    const run = pathRun(plan, r, 260 + r() * 260);
    const off = w ? -4 : 4; // inside the path (and its stair corridor), one walker on each side
    if (run) out.push({ kind: "walker", sector: index, seed: seed(), x: run[0], y: pathY(plan.gy, run[0]), route: [[run[0], pathY(plan.gy, run[0]) + off, 1200, "idle", off], [run[1], pathY(plan.gy, run[1]) + off, 1600, "idle", off]] });
  }
  actorCache.set(index, out);
  return out;
}

/**
 * Walkers gain tree visits once the cell's scenery has been painted (its tree positions are then known): each walk
 * goes to the foot of a reachable tree off the path, rests beneath it, and returns. Trees across water are skipped.
 */
function walkerRoute(a: Actor): Waypoint[] {
  const base = a.route!;
  if (a.kind !== "walker") return base;
  const trees = TREE_SPOTS.get(a.sector);
  if (!trees?.length) return base;
  const plan = sectorPlan(a.sector);
  const [p0, p1] = base;
  const pick = (px: number, py: number, salt: number) => {
    // both straight legs (path -> tree foot -> back onto the path) must cross only walkable ground: no water, pool or wall
    const c = trees.filter((t) => {
      if (!(Math.abs(t.x - px) < 160 && Math.abs(t.y - py) < 150 && Math.abs(t.y - py) > 30)) return false;
      const fx = t.x + (salt === 1 ? 8 : -8), fy = t.y + 8, bx = px + (salt === 1 ? 20 : -20), by = pathY(plan.gy, bx) + (p0[4] ?? 0);
      return freeSpot(plan, fx, fy, 6, false) && walkable(plan, px, py, fx, fy) && walkable(plan, fx, fy, bx, by);
    });
    return c.length ? c[Math.floor(hash2(a.seed, salt, 7) * c.length)] : null;
  };
  const t0 = pick(p0[0], p0[1], 1), t1 = pick(p1[0], p1[1], 2);
  const route = [p0];
  const back = (x: number, o: number | undefined): Waypoint => [x, pathY(plan.gy, x) + (o ?? 0), 400, "idle", o ?? 0];
  if (t0) route.push([t0.x + 8, t0.y + 8, 5200 + hash2(a.seed, 3, 1) * 3000, "rest"], back(p0[0] + 20, p0[4]));
  route.push(p1);
  if (t1) route.push([t1.x - 8, t1.y + 8, 4800 + hash2(a.seed, 4, 1) * 3000, "rest"], back(p1[0] - 20, p1[4]));
  return route;
}

const SPEED = 0.026; // world units per ms (about a slow stroll)
/** Position along a closed route with pauses, as a function of time; varied by seed so no two loop in step. */
export function along(route: Waypoint[], t: number, seed: number, frames: string, gy?: number): ActorFrame {
  // a leg between two on-path waypoints follows the path curve (its length measured along the curve)
  const onPath = (p: Waypoint, q: Waypoint) => gy !== undefined && p[4] !== undefined && q[4] !== undefined;
  const at = (p: Waypoint, q: Waypoint, f: number): [number, number] => {
    const x = p[0] + (q[0] - p[0]) * f;
    if (!onPath(p, q)) return [x, p[1] + (q[1] - p[1]) * f];
    return [x, pathY(gy!, x) + p[4]! + (q[4]! - p[4]!) * f];
  };
  const len = (p: Waypoint, q: Waypoint) => {
    if (!onPath(p, q)) return Math.hypot(q[0] - p[0], q[1] - p[1]);
    let d = 0, [x0, y0] = at(p, q, 0);
    for (let k = 1; k <= 16; k++) { const [x1, y1] = at(p, q, k / 16); d += Math.hypot(x1 - x0, y1 - y0); x0 = x1; y0 = y1; }
    return d;
  };
  const legs = route.map((p, i) => { const q = route[(i + 1) % route.length]; return { p, q, walk: len(p, q) / SPEED }; });
  const total = legs.reduce((s, l) => s + l.p[2] + l.walk, 0);
  let u = (t + seed % 100000) % total;
  for (const l of legs) {
    if (u < l.p[2]) {
      const k = l.p[3];
      const n = frameCount(k);
      return { x: l.p[0], y: l.p[1], frame: `${k}:${Math.floor(u / (k === "rest" ? 900 : 700)) % n}`, flip: l.q[0] < l.p[0] };
    }
    u -= l.p[2];
    if (u < l.walk) {
      const [x, y] = at(l.p, l.q, u / l.walk);
      return { x, y, frame: `${frames}:${Math.floor(u / 140) % 4}`, flip: l.q[0] < l.p[0] };
    }
    u -= l.walk;
  }
  return { x: route[0][0], y: route[0][1], frame: "idle:0", flip: false };
}

/** Every drawable frame of one actor at time t (a ritual yields its whole circle). t = 0 is the still pose. */
export function actorFrames(a: Actor, t: number, still: boolean): ActorFrame[] {
  const T = still ? 0 : t;
  const s = a.seed;
  switch (a.kind) {
    case "reader": {
      // reads for a varied while (eyes move along the lines), then turns a page in three frames
      const cyc = 7000 + (s % 4000), u = (T + s) % cyc;
      const turn = cyc - 900;
      const f = still ? 0 : u < turn ? (Math.floor(u / 1100) % 2) : 2 + Math.min(2, Math.floor((u - turn) / 300));
      return [{ x: a.x, y: a.y, frame: `read:${f}`, flip: !!a.flip }];
    }
    case "dancer": {
      // a seeded sequence of poses with uneven holds, so the dance never repeats in a short loop
      if (still) return [{ x: a.x, y: a.y, frame: "dance:0", flip: false }];
      const beat = 420 + (s % 160), n = Math.floor(T / beat);
      const restPhase = (n % 40) > 33; // pauses to catch its breath
      const pose = restPhase ? "idle:" + (n % 3) : `dance:${Math.floor(hash2(n, s, 5) * 5)}`;
      return [{ x: a.x + (restPhase ? 0 : ((n % 6) - 3) * 2), y: a.y - (!restPhase && n % 2 ? 2 : 0), frame: pose, flip: hash2(n >> 1, s, 6) < 0.5 }];
    }
    case "roller": {
      // stand, lie down, roll across the grass and back, stand up, look about
      const cyc = 9000 + (s % 3000), u = (T + s) % cyc;
      if (still || u < 1600) return [{ x: a.x, y: a.y, frame: `idle:${Math.floor(u / 600) % 3}`, flip: false }];
      if (u < 2000) return [{ x: a.x, y: a.y, frame: "getup:0", flip: false }];
      if (u < 4400) { const f = (u - 2000) / 2400; return [{ x: a.x + f * 44, y: a.y, frame: `roll:${Math.floor((u - 2000) / 150) % 4}`, flip: false }]; }
      if (u < 6800) { const f = (u - 4400) / 2400; return [{ x: a.x + 44 - f * 44, y: a.y, frame: `roll:${3 - (Math.floor((u - 4400) / 150) % 4)}`, flip: false }]; }
      if (u < 7300) return [{ x: a.x, y: a.y, frame: "curl:0", flip: false }];
      if (u < 7800) return [{ x: a.x, y: a.y, frame: "getup:0", flip: false }];
      return [{ x: a.x, y: a.y, frame: "dance:0", flip: false }]; // a happy stretch
    }
    case "ritual": {
      // a small circle, kneeling; lights raised and lowered together (cool mint, never a candle's amber)
      const n = a.ring ?? 5, raised = still ? false : Math.floor((T + s) / 2400) % 2 === 1;
      return Array.from({ length: n }, (_, i) => {
        const ang = (i / n) * Math.PI * 2 + 0.3;
        const x = a.x + Math.cos(ang) * 50, y = a.y + Math.sin(ang) * 50 * TILT;
        return { x, y, frame: `ritual:${raised ? 1 : 0}`, flip: Math.cos(ang) > 0, glow: "mint" as const };
      });
    }
    case "lantern": {
      const f = still ? { x: a.route![0][0], y: a.route![0][1], frame: "lift:0", flip: false } : along(a.route!, T, s, "lantern", sectorPlan(a.sector).gy);
      return [{ ...f, glow: "warm" }];
    }
    case "walker":
      return [still ? { x: a.route![0][0], y: a.route![0][1], frame: "idle:0", flip: false } : along(walkerRoute(a), T, s, "walk", sectorPlan(a.sector).gy)];
  }
}

/** Draw one frame: shadow, sprite (1 art pixel = PX world units, snapped), and for lanterns/rituals a soft glow. */
export function drawActor(ctx: CanvasRenderingContext2D, f: ActorFrame, time: number) {
  const im = frogAtlas();
  if (!im) return;
  const n = FRAME_INDEX[f.frame] ?? FRAME_INDEX["idle:0"];
  const w = CELL * PX, x = Math.round((f.x - w / 2) / PX) * PX, y = Math.round((f.y - w + 3 * PX) / PX) * PX;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(x + 5 * PX, y + w - 4 * PX, 10 * PX, PX);
  ctx.fillRect(x + 6 * PX, y + w - 3 * PX, 8 * PX, PX);
  if (f.flip) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(im, n * CELL, 0, CELL, CELL, 0, 0, w, w); ctx.restore(); }
  else ctx.drawImage(im, n * CELL, 0, CELL, CELL, x, y, w, w);
  if (f.glow) {
    const warm = f.glow === "warm";
    const gx = warm ? x + (f.flip ? w - 16 * PX : 16 * PX) : x + w / 2, gy = warm ? y + 14 * PX : y + (f.frame.endsWith("1") ? 6 : 12) * PX;
    const pulse = 0.85 + 0.15 * Math.sin(time / 500);
    const r = warm ? 34 : 18;
    const grd = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
    grd.addColorStop(0, warm ? `rgba(245,201,90,${0.28 * pulse})` : `rgba(125,255,176,${0.32 * pulse})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = grd;
    ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = "source-over";
  }
}
export const ACTOR_BOX = { w: CELL * PX, h: CELL * PX };
