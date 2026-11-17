/**
 * Deterministic garden geometry. A candle's place depends only on its onchain position
 * (id - 1), so every candle keeps its spot across reloads, devices and new purchases.
 * The garden grows in sectors laid out on a square spiral from the centre terrace.
 */
export const SECTOR_W = 1200;
export const SECTOR_H = 900;
export const SLOTS_PER_SECTOR = 96;
/**
 * Each sector is staged as one scene receding toward a vanishing point at its top centre: a stream
 * and candle path run down the middle, and six terraces line it on both sides. Far terraces are
 * shorter, closer together and hold smaller candles; near terraces are wide and hold larger ones.
 */
export const ROW_COUNTS = [8, 12, 14, 18, 20, 24]; // sums to SLOTS_PER_SECTOR
export const VANISH_X = SECTOR_W / 2;
/** Depth of each terrace: 0 = far, 1 = near. */
export const DEPTHS = ROW_COUNTS.map((_, i) => i / (ROW_COUNTS.length - 1));
/** Terrace baseline (fraction of sector height): spacing compresses with distance. */
export const terraceY = (d: number) => 0.24 + 0.66 * Math.pow(d, 1.45);
/** Candle/holder scale at a depth. */
export const depthScale = (d: number) => 0.5 + 0.7 * Math.pow(d, 1.2);
/** Half-width of the central stream path and of the terrace at a depth. */
export const pathHalf = (d: number) => 22 + 110 * d;
export const terraceHalf = (d: number) => 160 + 420 * d;
/** Terrace baselines as fractions of sector height (kept for callers that draw ledges). */
export const TERRACES = DEPTHS.map(terraceY);

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

/** Square spiral: 0 -> (0,0), 1 -> (1,0), 2 -> (1,-1)... */
export function spiral(n: number): [number, number] {
  if (n === 0) return [0, 0];
  const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2);
  let t = 2 * k + 1;
  let m = t * t;
  t -= 1;
  if (n >= m - t) return [k - (m - n), -k];
  m -= t;
  if (n >= m - t) return [-k, -k + (m - n)];
  m -= t;
  if (n >= m - t) return [-k + (m - n), k];
  return [k, k - (m - n - t)];
}

const spiralIndex = new Map<string, number>();
export function sectorAt(gx: number, gy: number): number | undefined {
  const key = `${gx},${gy}`;
  if (spiralIndex.size === 0) for (let i = 0; i < 4096; i++) spiralIndex.set(spiral(i).join(","), i);
  return spiralIndex.get(key);
}

export function sectorOrigin(sector: number): [number, number] {
  const [gx, gy] = spiral(sector);
  return [gx * SECTOR_W, gy * SECTOR_H];
}

/** Local slot coordinates and scale within a sector, cached: both sides of the path, a gentle bow, seeded jitter. */
const slotCache: [number, number, number][] = (() => {
  const r = mulberry(7);
  const out: [number, number, number][] = [];
  ROW_COUNTS.forEach((count, row) => {
    const d = DEPTHS[row];
    const sc = depthScale(d);
    const inner = pathHalf(d) + 14 * sc;
    const outer = terraceHalf(d);
    const per = count / 2;
    const used = [0, 0];
    for (let i = 0; i < count; i++) {
      // fill both banks from the path outward in an L R R L order, so a filling sector lights both banks evenly
      const left = (i + (i >> 1)) % 2 === 0;
      const side = left ? -1 : 1;
      const k = used[left ? 0 : 1]++;
      const u = (k + 0.5) / per;
      const off = inner + u * (outer - inner) + (r() - 0.5) * 6 * sc;
      const x = VANISH_X + side * off;
      const y = terraceY(d) * SECTOR_H - u * u * 16 * sc + (r() - 0.5) * 4 * sc;
      out.push([x, y, sc]);
    }
  });
  return out;
})();

export function positionOf(position: number): { x: number; y: number; scale: number; sector: number; slot: number } {
  const sector = Math.floor(position / SLOTS_PER_SECTOR);
  const slot = position % SLOTS_PER_SECTOR;
  const [ox, oy] = sectorOrigin(sector);
  const [lx, ly, scale] = slotCache[slot];
  return { x: ox + lx, y: oy + ly, scale, sector, slot };
}

/** Number of sectors to show: every filled sector plus one sector of empty holders to grow into. */
export function sectorCount(total: number): number {
  return Math.floor(total / SLOTS_PER_SECTOR) + 1;
}

export function worldBounds(total: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let s = 0; s < sectorCount(total); s++) {
    const [x, y] = sectorOrigin(s);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + SECTOR_W); maxY = Math.max(maxY, y + SECTOR_H);
  }
  return { minX, minY, maxX, maxY };
}

/** Hit test: the candle position nearest (x, y) within radius, or null. */
export function hitTest(x: number, y: number, total: number, radius: number): number | null {
  const gx = Math.floor(x / SECTOR_W);
  const gy = Math.floor(y / SECTOR_H);
  const sector = sectorAt(gx, gy);
  if (sector === undefined || sector >= sectorCount(total)) return null;
  const lx = x - gx * SECTOR_W;
  const ly = y - gy * SECTOR_H;
  let best: number | null = null;
  let bd = radius * radius;
  for (let s = 0; s < SLOTS_PER_SECTOR; s++) {
    const [sx, sy, sc] = slotCache[s];
    const dx = sx - lx;
    const dy = sy - 20 * sc - ly; // candle body sits above its base point
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = sector * SLOTS_PER_SECTOR + s;
    }
  }
  return best;
}
