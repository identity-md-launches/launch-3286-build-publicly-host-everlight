/**
 * Deterministic garden geometry. A candle's place depends only on its onchain position
 * (id - 1), so every candle keeps its spot across reloads, devices and new purchases.
 * The garden grows in sectors laid out on a square spiral from the centre terrace.
 */
export const SECTOR_W = 1200;
export const SECTOR_H = 900;
export const SLOTS_PER_SECTOR = 96;
const ROWS = 4;
const PER_ROW = SLOTS_PER_SECTOR / ROWS;
/** Terrace baselines (fraction of sector height) for the four candle paths. */
export const TERRACES = [0.3, 0.48, 0.66, 0.84];

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

/** Local slot coordinates within a sector, cached: a gentle curve per terrace with a seeded jitter. */
const slotCache: [number, number][] = (() => {
  const r = mulberry(7);
  const out: [number, number][] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let i = 0; i < PER_ROW; i++) {
      const u = (i + 0.5) / PER_ROW;
      const x = 60 + u * (SECTOR_W - 120) + (r() - 0.5) * 14;
      const y = TERRACES[row] * SECTOR_H + Math.sin(u * Math.PI * 2 + row) * 18 + (r() - 0.5) * 8;
      out.push([x, y]);
    }
  }
  return out;
})();

export function positionOf(position: number): { x: number; y: number; sector: number; slot: number } {
  const sector = Math.floor(position / SLOTS_PER_SECTOR);
  const slot = position % SLOTS_PER_SECTOR;
  const [ox, oy] = sectorOrigin(sector);
  const [lx, ly] = slotCache[slot];
  return { x: ox + lx, y: oy + ly, sector, slot };
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
    const [sx, sy] = slotCache[s];
    const dx = sx - lx;
    const dy = sy - 20 - ly; // candle body sits above its base point
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = sector * SLOTS_PER_SECTOR + s;
    }
  }
  return best;
}
