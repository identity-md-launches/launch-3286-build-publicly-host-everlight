/**
 * Deterministic garden geometry. A candle's place depends only on its onchain position (id - 1),
 * so every candle keeps its spot across reloads, devices and new purchases.
 *
 * The garden is one continuous landscape seen from a raised three-quarter view. It grows outward in
 * sectors (half-rings from the founding sector, see spiral()), but sectors are only bookkeeping: the scenery is
 * driven by world-space features that run through every sector.
 *  - Streams wind north-south. Each sector edge has its own seeded crossing point, shared by both
 *    sectors on that edge, so a stream leaves one sector exactly where it enters the next.
 *  - Paths wind east-west the same way and cross each stream on a bridge.
 *  - Candle holders stand on terraces: curved ledges whose arcs are ellipses (circles on the tilted
 *    ground plane), of seeded centre, radius, length and height, fitted around the water and paths.
 * No two sectors share a layout, and nothing is placed on a rectangular grid.
 */
export const SECTOR_W = 1200;
export const SECTOR_H = 900;
export const SLOTS_PER_SECTOR = 96;
/** Extra space around a sector that its scenery may paint into, so neighbours overlap without seams. */
export const SECTOR_MARGIN = 180;
/** Height above the slot point at which a candle stands in its pedestal cup (in scale units). */
export const HOLDER_TOP = 24;
/** Ground plane foreshortening: a circle of radius r on the ground appears as an ellipse r x r*TILT. */
export const TILT = 0.42;
/** In a sector with no neighbour to the north, the land begins this far down; the vista shows above. */
export const HORIZON_CUT = 210;

/** World y of the land's northern skyline (the garden's horizon) at world x; shared by the land fill and row-0 scenery. */
export function horizonY(x: number): number {
  return HORIZON_CUT - 30 - 34 * Math.sin(x / 150) - 22 * Math.sin(x / 61) - 40 * Math.sin(x / 430);
}

/** Camera limits: the garden's extent plus a ring of wild forest, never north of the skyline. */
export const WILD_PAD = 900;
export function cameraBounds(total: number) {
  const b = worldBounds(total);
  return { minX: b.minX - WILD_PAD, maxX: b.maxX + WILD_PAD, minY: 0, maxY: b.maxY + WILD_PAD * 0.7 };
}

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of integer coordinates to [0, 1). */
export function hash2(x: number, y: number, salt = 0) {
  return mulberry(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt + 1, 83492791))();
}

/**
 * Sector order: U-shaped half-rings that grow outward and toward the viewer from the founding sector,
 * never north of it, so the garden's northern edge is always the home row with the vista behind it.
 * Ring k holds the cells with max(|gx|, gy) = k and gy >= 0 (4k + 1 cells): down the east side, along the
 * near row from east to west, then back up the west side. 0 -> (0,0), 1 -> (1,0), 2 -> (1,1), 3 -> (0,1)...
 */
const ringBase = (k: number) => 2 * k * k - k;
export function spiral(n: number): [number, number] {
  let k = Math.floor((1 + Math.sqrt(1 + 8 * n)) / 4);
  while (ringBase(k) > n) k--;
  while (ringBase(k + 1) <= n) k++;
  const i = n - ringBase(k);
  if (i < k) return [k, i];
  if (i < 3 * k + 1) return [k - (i - k), k];
  return [-k, k - 1 - (i - (3 * k + 1))];
}

/** Inverse of spiral() in closed form: the sector index at grid cell (gx, gy), or -1 north of the home row. No cap. */
export function sectorAt(gx: number, gy: number): number {
  if (gy < 0) return -1;
  const k = Math.max(Math.abs(gx), gy);
  const base = ringBase(k);
  if (gx === k && gy < k) return base + gy;
  if (gy === k) return base + k + (k - gx);
  return base + 3 * k + 1 + (k - 1 - gy);
}

export function sectorOrigin(sector: number): [number, number] {
  const [gx, gy] = spiral(sector);
  return [gx * SECTOR_W, gy * SECTOR_H];
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** World x of the stream in grid column gx at world height y. Continuous (C1) across sector edges. */
/** Where a column's stream crosses the top edge of cell (gx, gy). The founding sector keeps its left side dry for the entrance. */
const edgeX = (gx: number, gy: number) => (gx === 0 && (gy === 0 || gy === 1) ? 760 : 300 + 600 * hash2(gx, gy, 1));
export function streamX(gx: number, y: number): number {
  const gy = Math.floor(y / SECTOR_H);
  const t = y / SECTOR_H - gy;
  const a = edgeX(gx, gy);
  const b = edgeX(gx, gy + 1);
  const bend = gx === 0 && gy === 0 ? 180 : (hash2(gx, gy, 2) - 0.5) * 420;
  const s = Math.sin(Math.PI * t);
  return gx * SECTOR_W + a + (b - a) * smooth(t) + bend * s * s;
}

/** World y of the path in grid row gy at world x. Continuous across sector edges. */
export function pathY(gy: number, x: number): number {
  const gx = Math.floor(x / SECTOR_W);
  const t = x / SECTOR_W - gx;
  const a = 420 + 300 * hash2(gx, gy, 3);
  const b = 420 + 300 * hash2(gx + 1, gy, 3);
  const bend = (hash2(gx, gy, 4) - 0.5) * 220;
  const s = Math.sin(Math.PI * t);
  return gy * SECTOR_H + a + (b - a) * smooth(t) + bend * s * s;
}

export interface Terrace {
  /** ellipse centre (world), radius in x; the arc runs from a0 to a1 (radians, 0 = east, PI/2 = front) */
  cx: number; cy: number; rx: number; a0: number; a1: number;
  /** retaining wall height and candle scale */
  wall: number; scale: number;
  /** slot range [first, first + count) within the sector */
  first: number; count: number;
}

export interface SectorPlan {
  index: number; gx: number; gy: number; ox: number; oy: number;
  terraces: Terrace[];
  /** world [x, y, scale] per slot, slot order = fill order */
  slots: [number, number, number][];
  /** world positions chosen for the sector's features */
  bridge: { x: number; y: number; angle: number };
  gazebo: { x: number; y: number } | null;
  fall: { x: number; y: number };
  pools: { x: number; y: number; rx: number }[];
  /** the founding sector has a hero pedestal in the foreground (slot 0) and an entrance path */
  hero: { x: number; y: number } | null;
}

const planCache = new Map<number, SectorPlan>();

function streamDist(gx: number, x: number, y: number) {
  return Math.abs(x - streamX(gx, y));
}

/** Sector layout: terraces fitted around the stream, path, pools and gazebo; seeded by grid cell. */
export function sectorPlan(index: number): SectorPlan {
  const hit = planCache.get(index);
  if (hit) return hit;
  const [gx, gy] = spiral(index);
  const ox = gx * SECTOR_W, oy = gy * SECTOR_H;
  const r = mulberry(0x9e37 + Math.imul(gx, 7919) + Math.imul(gy, 104729));
  const sy = (x: number) => pathY(gy, x);
  // bridge where the path crosses the stream: iterate to the crossing point
  let by = oy + 560;
  for (let i = 0; i < 6; i++) by = sy(streamX(gx, by));
  const bx = streamX(gx, by);
  const slope = (sy(bx + 20) - sy(bx - 20)) / 40;
  const bridge = { x: bx, y: by, angle: Math.atan(slope) * 0.6 };
  // waterfall and pools at seeded places along the stream, away from the bridge
  const fy = oy + (by - oy > 450 ? 160 + r() * 180 : 620 + r() * 160);
  const fall = { x: streamX(gx, fy), y: fy };
  const pools: SectorPlan["pools"] = [];
  const py = fy + (fy < by ? 1 : -1) * (90 + r() * 60);
  if (Math.abs(py - by) > 120) pools.push({ x: streamX(gx, py), y: py, rx: 90 + r() * 60 });
  const hero = index === 0 ? { x: ox + 330, y: oy + 470 } : null;
  const top = HORIZON_CUT + 50;
  const terraces: Terrace[] = [];
  const slots: [number, number, number][] = [];
  const blockers: { x: number; y: number; r: number }[] = [
    { x: bx, y: by, r: 120 },
    ...pools.map((p) => ({ x: p.x, y: p.y, r: p.rx + 40 })),
  ];
  let gazebo: SectorPlan["gazebo"] = null;
  for (let i = 0; i < 20 && !gazebo; i++) {
    const x = ox + 150 + r() * 900, y = oy + top + 40 + r() * 420;
    if (streamDist(gx, x, y) > 180 && Math.abs(y - sy(x)) > 130) gazebo = { x, y };
  }
  if (gazebo) blockers.push({ x: gazebo.x, y: gazebo.y - 40, r: 110 });
  if (hero) {
    blockers.push({ x: hero.x, y: hero.y - 40, r: 150 });
    slots.push([hero.x, hero.y, 2.1]);
    terraces.push({ cx: hero.x, cy: hero.y, rx: 0, a0: 0, a1: 0, wall: 0, scale: 2.1, first: 0, count: 1 });
  }
  const ok = (x: number, y: number, sc: number) => {
    if (x < ox + 40 || x > ox + SECTOR_W - 40 || y < oy + top || y > oy + SECTOR_H - 30) return false;
    if (streamDist(gx, x, y) < 70 + 30 * sc) return false;
    if (Math.abs(y - sy(x)) < 46 + 10 * sc) return false;
    for (const b of blockers) if (Math.hypot(x - b.x, (y - b.y) / TILT) < b.r) return false;
    for (const s of slots) if (Math.abs(s[0] - x) < 30 * sc && Math.abs(s[1] - y) < 26 * sc) return false;
    return true;
  };
  let tries = 0;
  while (slots.length < SLOTS_PER_SECTOR && tries < 4000) {
    tries++;
    const rx = 90 + r() * 170;
    const cx = ox + 60 + r() * (SECTOR_W - 120);
    const cy = oy + top - 30 + r() * (SECTOR_H - top);
    // scale grows gently toward the front of each sector band, plus per-terrace variation
    const scale = 0.82 + 0.16 * ((cy - oy) / SECTOR_H) + (r() - 0.5) * 0.08;
    const mid = Math.PI / 2 + (r() - 0.5) * 0.9;
    const span = 0.7 + r() * 1.5;
    const step = (32 * scale) / rx;
    const want = Math.min(SLOTS_PER_SECTOR - slots.length, Math.max(3, Math.floor(span / step)));
    const pts: [number, number, number][] = [];
    for (let k = 0; k < want; k++) {
      const a = mid - span / 2 + (k + 0.5) * step;
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * rx * TILT;
      if (!ok(x, y, scale)) break;
      pts.push([x, y, scale]);
    }
    if (pts.length < 3 || (pts.length < want && tries < 3000)) continue;
    const a0 = mid - span / 2, a1 = a0 + pts.length * step;
    terraces.push({ cx, cy, rx, a0, a1, wall: (14 + r() * 22) * scale, scale, first: slots.length, count: pts.length });
    slots.push(...pts);
  }
  // fallback, only if the seeded search ran dry: fill remaining slots on short arcs wherever they fit
  for (let y = oy + top; slots.length < SLOTS_PER_SECTOR && y < oy + SECTOR_H; y += 7) {
    for (let x = ox + 40; slots.length < SLOTS_PER_SECTOR && x < ox + SECTOR_W - 40; x += 11) {
      if (ok(x, y, 0.85)) {
        terraces.push({ cx: x, cy: y - 60 * TILT, rx: 60, a0: Math.PI / 2, a1: Math.PI / 2 + 0.5, wall: 12, scale: 0.85, first: slots.length, count: 1 });
        slots.push([x, y, 0.85]);
      }
    }
  }
  const plan: SectorPlan = { index, gx, gy, ox, oy, terraces, slots, bridge, gazebo, fall, pools, hero };
  planCache.set(index, plan);
  return plan;
}

export function positionOf(position: number): { x: number; y: number; scale: number; sector: number; slot: number } {
  const sector = Math.floor(position / SLOTS_PER_SECTOR);
  const slot = position % SLOTS_PER_SECTOR;
  const [x, y, scale] = sectorPlan(sector).slots[slot];
  return { x, y, scale, sector, slot };
}

/** The empty garden already holds this many individually addressable (unlit) holder positions. */
export const MIN_POSITIONS = 10_000;
/** Sectors cultivated before any purchase: enough 96-slot districts for MIN_POSITIONS (105 sectors, 10,080 holders). */
export const MIN_SECTORS = Math.ceil(MIN_POSITIONS / SLOTS_PER_SECTOR);
/**
 * Number of cultivated sectors: at least MIN_SECTORS (every holder present and unlit until a confirmed purchase
 * fills it), then every filled sector plus one sector of empty holders to grow into. This is a visual capacity
 * only; the onchain supply rules are the contract's.
 */
export function sectorCount(total: number): number {
  return Math.max(MIN_SECTORS, Math.floor(total / SLOTS_PER_SECTOR) + 1);
}

/** Whether the neighbouring cells of a sector are part of the garden: [north, east, south, west]. */
export function neighbours(sector: number, count: number): [boolean, boolean, boolean, boolean] {
  const [gx, gy] = spiral(sector);
  const has = (x: number, y: number) => { const n = sectorAt(x, y); return n >= 0 && n < count; };
  return [has(gx, gy - 1), has(gx + 1, gy), has(gx, gy + 1), has(gx - 1, gy)];
}

export function worldBounds(total: number) {
  const n = sectorCount(total);
  const [lx, ly] = spiral(n - 1);
  const k = Math.max(Math.abs(lx), ly);
  // rings inside the last one are complete; the last ring may be partial
  let minX = 0, minY = 0, maxX = SECTOR_W, maxY = SECTOR_H;
  if (k > 0) { minX = -(k - 1) * SECTOR_W; maxX = k * SECTOR_W; maxY = k * SECTOR_H; }
  for (let s = ringBase(k); s < n; s++) {
    const [x, y] = sectorOrigin(s);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + SECTOR_W); maxY = Math.max(maxY, y + SECTOR_H);
  }
  return { minX, minY, maxX, maxY };
}

/** Vertical extent of a rendered candle above its slot point, in slot-scale units: holder foot to flame tip. */
export const CANDLE_TOP = 84;
/**
 * Hit test against the whole rendered candle: holder, wax body and flame, i.e. the vertical segment from the
 * slot point (holder foot) to the flame tip, widened by its own half-width or the minimum touch radius `radius`
 * (world units), whichever is larger. Overlaps resolve to the closest candle. Searches the 3x3 sector neighbourhood.
 */
export function hitTest(x: number, y: number, total: number, radius: number): number | null {
  const gx = Math.floor(x / SECTOR_W);
  const gy = Math.floor(y / SECTOR_H);
  const count = sectorCount(total);
  let best: number | null = null;
  let bd = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const sector = sectorAt(gx + dx, gy + dy);
    if (sector < 0 || sector >= count) continue;
    const slots = sectorPlan(sector).slots;
    for (let s = 0; s < SLOTS_PER_SECTOR; s++) {
      const [sx, sy, sc] = slots[s];
      const top = sy - CANDLE_TOP * sc;
      const cy = y < top ? top : y > sy ? sy : y; // nearest point on the holder-to-flame segment
      const d = Math.hypot(sx - x, cy - y);
      if (d <= Math.max(radius, 16 * sc) && d < bd) {
        bd = d;
        best = sector * SLOTS_PER_SECTOR + s;
      }
    }
  }
  return best;
}
