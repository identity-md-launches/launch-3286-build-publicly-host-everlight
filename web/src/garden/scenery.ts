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
export const streamHalf = (y: number) => 32 + 7 * Math.sin(y / 90) + 3 * Math.sin(y / 37);
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
      // natural banks: an irregular earth-and-moss margin whose width wanders along the stream (world-space noise)
      const wob = 3 + 4 * (0.5 + 0.5 * Math.sin(y / 23 + gx * 1.7)) + 3 * (0.5 + 0.5 * Math.sin(y / 9.5 + x / 31));
      if (ds < hw || pool < 1) {
        // deep water: darker in the channel, lighter toward the banks, with sky reflections in long soft streaks
        const edge = hasStream && ds < hw ? ds / hw : Math.sqrt(Math.max(0, pool));
        const depth = 0.62 + 0.38 * edge;
        // quiet water (no sheared tile, which read as uniform diagonal stripes): a depth gradient, the banks' dark
        // green reflection along each edge, and a few short horizontal glints that never line up into a pattern
        const glint = hash2(X >> 2, Y, 31) > 0.985 && edge < 0.8;
        const refl = edge > 0.72 ? 0.55 + 0.45 * ((1 - edge) / 0.28) : 1;
        if (glint) { d[o] = 120; d[o + 1] = 205; d[o + 2] = 180; d[o + 3] = 255; continue; }
        const wr = 12 + 10 * (1 - edge), wg = 52 + 44 * (1 - edge * 0.7), wb = 50 + 30 * (1 - edge * 0.7);
        d[o] = wr * depth * (refl < 1 ? 0.9 : 1); d[o + 1] = wg * depth * refl + (refl < 1 ? 14 * (1 - refl) : 0); d[o + 2] = wb * depth * refl; d[o + 3] = 255;
        void water;
        continue;
      }
      if (ds < hw + 2 || pool < 1.06) { put(o, null, X, Y, [16, 30, 24]); continue; } // wet edge line
      if (ds < hw + 2 + wob || pool < 1.06 + wob / 60) {
        const stone = hash2(X >> 1, Y >> 1, 9) > 0.62; // scattered mossy bank stones
        put(o, stone ? moss : null, X, Y, stone ? [63, 122, 60] : [38, 46, 30], stone ? 0.7 : 0.9 + 0.1 * (hash2(X, Y, 4) - 0.5));
        continue;
      }
      const dp = Math.abs(y - pathY(gy, x));
      if (dp < 20) { put(o, path, X, Y, [100, 100, 83], 0.85); continue; }
      if (dp < 24) { put(o, dither(X, Y, 0.5) ? moss : dark, X, Y, [42, 82, 51]); continue; }
      // quiet dark ground: one deep emerald with a slow tonal field and only a faint trace of the grass tile, so the
      // terraces, paths, water and candles carry the detail (replaces the earlier two-tile dither noise)
      const f = 0.5 * Math.sin(x / 173 + y / 97) + 0.5 * Math.sin(x / 61 - y / 133);
      const ti = ((Y & 15) * 16 + (X & 15)) * 4;
      const tex = dark ? (dark[ti + 1] - 60) / 255 : 0;
      const lum = 1 + 0.07 * f + 0.12 * tex - (wild ? 0.14 : 0);
      // atmospheric perspective: toward the skyline the ground lifts into a cool blue-green haze
      const haze = gy === 0 ? Math.max(0, 1 - (y - horizonY(x)) / 220) : 0;
      const r0 = 20 * lum, g0 = 40 * lum, b0 = 29 * lum;
      d[o] = r0 + (34 - r0) * haze * 0.7; d[o + 1] = g0 + (58 - g0) * haze * 0.7; d[o + 2] = b0 + (62 - b0) * haze * 0.7; d[o + 3] = 255;
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
      const v = r(), n = v < 0.3 ? "cypress" : v < 0.5 ? "willow" : v < 0.65 ? "willow-s" : v < 0.75 ? "willow-l" : "tree";
      put(n, x, oy + horizonY(x) + 12 + r() * 14, r() < 0.5);
    }
  }
  const items: Item[] = [];
  const stairs = wild ? { terraces: [] as Stair[], gazebo: null, flush: new Set<number>() } : stairsOf(plan);
  // ground first: flagstone walks from stair feet to the path
  for (const st of stairs.terraces) {
    if (st.walk) drawWalk(g, st.walk, pathPat);
    for (const l of st.links ?? []) drawWalk(g, l, pathPat);
  }
  if (stairs.gazebo?.stair?.walk) drawWalk(g, stairs.gazebo.stair.walk, pathPat);
  if (stairs.gazebo?.back) drawWalk(g, stairs.gazebo.back, pathPat);
  const stairOf = new Map(stairs.terraces.map((st) => [st.terrace, st] as const));
  const flush = stairs.flush;
  // one of four terrace arrangements per sector, from its grid seed (decoration only: slot coordinates never move)
  const arrangement = terraceArrangement(gx, gy);
  if (!wild) plan.terraces.forEach((t, ti) => items.push({ y: t.cy + t.rx * TILT, draw: () => drawTerrace(g, t, plan.slots, im, wallPat, lawnPat, pathPat, put, r, stairOf.get(ti), flush.has(ti), arrangement) }));
  const onStairs = (x: number, y: number, rad: number) => {
    const all = stairs.gazebo?.stair ? [...stairs.terraces, stairs.gazebo.stair] : stairs.terraces;
    for (const st of all) {
      if (Math.abs(x - st.x) < st.halfW + rad * 0.5 + 8 && y > st.yTop - 6 && y - rad * 0.9 < st.yTop + st.drop + 6) return true;
      for (const w of [st.walk, st === stairs.gazebo?.stair ? stairs.gazebo.back : null, ...(st.links ?? [])]) {
        if (!w) continue;
        // distance from the item's foot (and a point up its height) to the walk's centre line
        const [x0, y0, x1, y1] = w, L2 = (x1 - x0) ** 2 + (y1 - y0) ** 2;
        for (const py of [y, y - rad * 0.6]) {
          const k = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (py - y0) * (y1 - y0)) / L2));
          if (Math.hypot(x - (x0 + (x1 - x0) * k), py - (y0 + (y1 - y0) * k)) < WALK_HALF + rad * 0.5 + 6) return true;
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
    const v = r();
    // a willow cluster: 2 to 4 trunks of mixed sizes around one spot, each depth-sorted on its own foot
    const group: [string, number, number][] = v < 0.5
      ? Array.from({ length: 2 + ((r() * 3) | 0) }, (_, k) => {
          const sz = r();
          return [sz < 0.35 ? "willow-s" : sz < 0.75 ? "willow" : "willow-l", x + (k === 0 ? 0 : (r() - 0.5) * 70), y + (k === 0 ? 0 : (r() - 0.5) * 26)] as [string, number, number];
        })
      : [[v < 0.72 ? "cypress" : "tree", x, y]];
    if (wild && y - oy < 120) continue; // low growth along a wild cell's north edge keeps the garden row behind visible
    const ok = group.filter(([n, gx2, gy2]) => fits(gy2 + 6, hOf(n)) && clear(gx2, gy2, hOf(n) * 0.4));
    if (ok.length < Math.min(2, group.length)) continue;
    placed += ok.length > 1 ? 2 : 1;
    for (const [n, gx2, gy2] of ok) { const flip = r() < 0.5; items.push({ y: gy2, draw: () => put(n, gx2, gy2 + 4, flip) }); }
  }
  for (let i = 0, placed = 0; i < (wild ? 900 : 400) && placed < (wild ? 160 : 90); i++) {
    const x = ox - 20 + r() * (W + 40), y = oy + r() * H;
    if (!fits(y + 4, 24) || !clear(x, y, 24)) continue;
    placed++;
    const v = r(), n = v < 0.22 ? "bush-flower" : v < 0.62 ? "bush" : v < 0.72 ? "flowers" : "rock", flip = r() < 0.5;
    items.push({ y, draw: () => put(n, x, y + 4, flip) });
  }
  // lily pads and water flowers on the pools and stream
  for (const p of plan.pools) for (let k = 0; k < 5; k++) {
    const a = r() * Math.PI * 2, q = 0.3 + r() * 0.5;
    const x = p.x + Math.cos(a) * p.rx * q, y = p.y + Math.sin(a) * p.rx * TILT * q;
    items.push({ y: y - 400, draw: () => put(r() < 0.4 ? "lilypad-flower" : "lilypad", x, y) });
  }
  {
    const spr = gy === 0 ? springY(gx) : -Infinity;
    const rr = mulberry(9100 + index * 17);
    for (let y = oy + 10; y < oy + H; y += 18 + rr() * 26) {
      if (y < spr + 20 || Math.abs(y - pathY(gy, streamX(gx, y))) < 70) continue; // leave the bridge and its approaches open
      for (const side of [-1, 1]) {
        if (rr() < 0.35) continue;
        const x = streamX(gx, y) + side * (streamHalf(y) + 6 + rr() * 6), n = rr() < 0.82 ? "reeds" : "bank-stones";
        if (!wild && plan.slots.some((sl) => Math.abs(sl[0] - x) < 26 && Math.abs(sl[1] - y) < 40)) continue;
        const yy = y, flip = rr() < 0.5;
        items.push({ y: yy, draw: () => put(n, x, yy + 3, flip) });
      }
      if (rr() < 0.22) { const lx = streamX(gx, y) + (rr() - 0.5) * streamHalf(y), ly = y + 6; items.push({ y: ly - 400, draw: () => put(rr() < 0.4 ? "lilypad-flower" : "lilypad", lx, ly) }); }
    }
  }
  if (plan.gazebo && !wild) {
    // a ruined colonnade: two arches on a mossy plinth, draped with vines
    const { x, y } = plan.gazebo;
    // the arches stand on a raised flagstone plinth; a central flight leads down toward the path
    const gs = stairs.gazebo!;
    items.push({ y, draw: () => {
      drawPlinth(g, x, y, wallPat, pathPat);
      put("arch", x - 34, y + 4); put("arch", x + 34, y + 4, true); put("vine", x - 52, y - 54); put("vine", x + 18, y - 58);
      put("garland", x - 34, y + 4); put("garland", x + 34, y + 4, true); // flower swags and a hung green lantern
      if (gs.stair) drawStair(g, gs.stair, wallPat, pathPat);
      put("flowers", x - 40, y + 26); put("flowers", x + 40, y + 26);
    } });
  }
  {
    const b = plan.bridge;
    items.push({ y: b.y + 20, draw: () => drawBridge(g, b, gy, pathPat, wallPat, im, put, wild, gx) });
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
  if (!wild) {
    // vignettes: a fisher on the bank below the bridge, a frog on a pool's lily pad, a sweeper on the path
    const k = hash2(gx, gy, 23);
    if (k < 0.6) {
      const fy = plan.bridge.y + 90 + hash2(gx, gy, 24) * 80, side = k < 0.3 ? -1 : 1;
      const fx = streamX(gx, fy) + side * (streamHalf(fy) + 16);
      if (!plan.slots.some((sl) => Math.abs(sl[0] - fx) < 40 && Math.abs(sl[1] - fy) < 50) && fy < oy + H - 20) frogs.push(["frog-fisher", fx, fy]);
    }
    const pool = plan.pools[0];
    if (pool && k > 0.25) frogs.push(["frog-lily", pool.x + pool.rx * 0.25, pool.y + 4]);
    if (k > 0.45 && k < 0.85) for (let i = 0; i < 30; i++) {
      const x = ox + 120 + r() * (W - 240), y = pathY(gy, x) + 6;
      if (Math.abs(x - streamX(gx, y)) > 160 && !plan.slots.some((sl) => Math.abs(sl[0] - x) < 30 && Math.abs(sl[1] - y) < 40)) { frogs.push(["frog-sweeper", x, y]); break; }
    }
  }
  frogs.forEach(([n, x, y], i) => items.push({ y, draw: () => put(n, x, y, n === "frog-fisher" ? x > streamX(gx, y) : i % 2 === 1) }));
  items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());
  g.restore();
}

function drawBridge(
  g: CanvasRenderingContext2D, b: SectorPlan["bridge"], gy: number, pathPat: CanvasPattern | null, wallPat: CanvasPattern | null,
  im: Sheet["img"], put: (n: string, x: number, y: number, flip?: boolean) => void, wild: boolean, gx: number,
) {
  const half = 90, deck = 20, rise = 12;
  for (let x = snap(b.x - half); x <= b.x + half; x += PX) {
    const y0 = snap(pathY(gy, x)), dx = (x - b.x) / 58;
    // an arched deck: it climbs from the path at each head to a crown over the water
    const lift = snap(rise * Math.max(0, 1 - ((x - b.x) / half) ** 2));
    const y = y0 - lift;
    // reflection under the span: the face and the arch's underside mirrored on the water, in broken rows
    {
      const water = y0 + deck + 34, open = Math.abs(dx) < 1 ? 26 * Math.sqrt(1 - dx * dx) : 0;
      if (Math.abs(x - streamX(gx, water)) < streamHalf(water) - 2) {
        for (let k = snap(open); k < 34 + lift; k += PX * 2) { g.fillStyle = k < open + 4 ? "rgba(196,187,152,0.22)" : "rgba(30,34,30,0.55)"; g.fillRect(x, water + k, PX, PX); }
      }
    }
    g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(x, y + deck, PX, lift); // the face grows with the arch
    // deck: flagstones continuous with the path
    g.fillStyle = pathPat ?? "#646453"; g.fillRect(x, y - deck, PX, deck * 2);
    // front face with a round arch opening over the water
    const face = 34 + lift, open = Math.abs(dx) < 1 ? Math.round((26 * Math.sqrt(1 - dx * dx)) / PX) * PX : 0;
    g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(x, y + deck, PX, face - open);
    if (open) { // voussoir ring and the shadow under the arch, so the opening reads over the water
      const at = y + deck + face - open;
      g.fillStyle = "#c4bb98"; g.fillRect(x, at - PX * 2, PX, PX); g.fillStyle = "#8f8b74"; g.fillRect(x, at - PX, PX, PX);
      g.fillStyle = "rgba(5,10,8,0.6)"; g.fillRect(x, at, PX, PX * 3);
    }
    if (hash2(x, 5, 12) < 0.18) { g.fillStyle = "#3f7a3c"; g.fillRect(x, y + deck, PX, snap(2 + hash2(x, 6, 12) * 8)); } // moss down the face
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
  put: (n: string, x: number, y: number, flip?: boolean) => void, r: () => number, stair?: Stair, flush = false, arrangement = 0,
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
    // a ground-level bed (no flight could reach the path from its wall): a low stone kerb at path height, never a
    // raised platform, so the holders on it are reached from the surrounding ground
    const wall = flush ? PX * 2 : snap(t.wall);
    for (const [X, { yo, yi }] of cols) {
      // the ground rises to the lawn behind (an earth bank), so the terrace is cut into a slope rather than floating
      if (!flush) { g.fillStyle = "#132a1c"; g.fillRect(X, yi - PX * 3, PX, PX * 3); g.fillStyle = "#183622"; if (dither(X / PX, 1, 0.5)) g.fillRect(X, yi - PX * 4, PX, PX); }
      g.fillStyle = lawnPat ?? "#1c3a26"; g.fillRect(X, yi, PX, yo - yi);
      g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(X, yo, PX, wall);
      g.fillStyle = "#050a08"; g.fillRect(X, yo + wall, PX, PX); // foot shadow line
      // contact shadow on the ground in front of the wall, fading in dithered rows
      for (let k = 1; k <= 4; k++) if (dither(X / PX, k, 0.8 - k * 0.18)) { g.fillStyle = "rgba(5,10,8,0.55)"; g.fillRect(X, yo + wall + k * PX, PX, PX); }
      g.fillStyle = (X / PX) % 7 === 0 ? "#a7d36a" : "#6aa84f"; g.fillRect(X, yo - PX, PX, PX); // mossy coping
      g.fillStyle = "#c4bb98"; g.fillRect(X, yo, PX, PX);
      if (!flush && hash2(X, yo, 3) < 0.09) { g.fillStyle = "#3f7a3c"; g.fillRect(X, yo + PX, PX, snap(4 + hash2(X, 1, 4) * (wall - 4))); } // hanging moss
    }
    // white flowers at the wall foot and shrubs on the lawn behind the holders
    const keys = [...cols.keys()];
    for (let k = 0; k < Math.max(1, t.count / 5); k++) { const X = keys[(r() * keys.length) | 0]; const c = cols.get(X)!; put("flowers", X, c.yo + wall + 8); }
    for (let k = 0; k < Math.max(1, t.count / 6); k++) { const X = keys[(r() * keys.length) | 0]; const c = cols.get(X)!; put(r() < 0.5 ? "bush" : "bush-flower", X, c.yi + 4, r() < 0.5); }
    // arrangement detail along this terrace
    const ends: [number, boolean][] = [[keys[0], stair?.end !== 0], [keys[keys.length - 1], stair?.end !== 1]];
    if (arrangement === 0) { // clipped hedge along the back of the lawn
      for (let k = 0; k < keys.length; k += 7) { const X = keys[k]; put("bush", X, cols.get(X)!.yi + 3, k % 2 === 0); }
    } else if (arrangement === 1) { // flower border: blossoms along the coping and pink sprays on the wall face
      for (let k = 3; k < keys.length; k += 9) { const X = keys[k]; put("flowers", X, cols.get(X)!.yo + PX); }
      for (const X of keys) if (hash2(X, 2, 13) < 0.12) { const c = cols.get(X)!; g.fillStyle = hash2(X, 3, 13) < 0.5 ? "#d98aa8" : "#f2c4d2"; g.fillRect(X, c.yo + PX * 2, PX, PX); g.fillStyle = "#3f7a3c"; g.fillRect(X, c.yo + PX * 3, PX, PX * 2); }
    } else if (arrangement === 2) { // lantern walk: green lamps at the free ends, vines on the wall
      for (const [X, free] of ends) if (free && X !== undefined) put("lamp", X, cols.get(X)!.yo + 2);
      for (let k = 5; k < keys.length; k += 13) { const X = keys[k]; put("vine", X, cols.get(X)!.yo + snap(wall * 0.8)); }
    } else { // old ruin: broken pillar stubs at the free ends, boulders at the wall foot
      for (const [X, free] of ends) if (free && X !== undefined) {
        const c = cols.get(X)!, hgt = snap(16 + hash2(X, c.yo, 14) * 14);
        g.fillStyle = wallPat ?? "#3f413a"; g.fillRect(X - PX * 3, c.yo + wall - hgt - wall, PX * 6, hgt + wall);
        g.fillStyle = "#8f8b74"; g.fillRect(X - PX * 3, c.yo - hgt, PX * 2, hgt);
        g.fillStyle = "#6aa84f"; g.fillRect(X - PX * 3, c.yo - hgt - PX, PX * 6, PX);
        g.fillStyle = "#050a08"; g.fillRect(X - PX * 4, c.yo + wall, PX * 8, PX);
      }
      for (let k = 6; k < keys.length; k += 17) { const X = keys[k]; put("rock", X, cols.get(X)!.yo + wall + 10); }
    }
    if (stair) drawStair(g, stair, wallPat, pathPat);
  }
  const mine = slots.slice(t.first, t.first + t.count).sort((a, b) => a[1] - b[1]);
  for (const [x, y, k] of mine) put(k > 1.5 ? "pedestal-hero" : "holder", x, y + 2);
  void im;
}


/** Which of the four terrace arrangements a sector uses (hedge, flower border, lantern walk, old ruin). */
export const terraceArrangement = (gx: number, gy: number) => Math.min(3, Math.floor(hash2(gx, gy, 21) * 4));

/** A flight of steps standing in front of a retaining wall or plinth: coping at yTop, foot at yTop + drop. */
export interface Stair {
  x: number; yTop: number; drop: number; halfW: number; walk: [number, number, number, number] | null; terrace: number; pad: number; end: 0 | 1;
  /** Fallback route when no straight walk reaches the path: one or two flagstone legs to the path or to the foot of a
   * neighbouring terrace's steps that is already connected. */
  links?: [number, number, number, number][];
  /** True when this flight's foot reaches the main path, directly or through other terraces. */
  connected?: boolean;
}

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

/** Is (x, y) on a raised terrace's lawn or retaining wall (other than those in `skip`)? */
function onTerrace(plan: SectorPlan, x: number, y: number, skip: number[]) {
  for (let i = 0; i < plan.terraces.length; i++) {
    const t = plan.terraces[i];
    if (t.rx <= 0 || skip.includes(i)) continue;
    const R = t.rx + 16 * t.scale, depth = 46 * t.scale;
    const dx = x - t.cx, dy = (y - t.cy) / TILT, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (a < t.a0 - 0.25 || a > t.a1 + 0.25) continue;
    if (r > R - depth - 8 && r < R + 8 + t.wall / TILT) return true;
  }
  return false;
}

/** A flagstone walk from (x0, y0) to (x1, y1) that touches no slot box, no water and no other terrace. */
function walkClear(plan: SectorPlan, x0: number, y0: number, x1: number, y1: number, skip: number[] | null = null) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    if (i > 1 && i < n - 1 && wet(plan, x, y, WALK_HALF)) return false;
    if (skip && i > 1 && i < n - 1 && onTerrace(plan, x, y, skip)) return false;
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

/** Diagnostic: why raised terraces got no flight (counted once per terrace, read by tests). */
export const WHY: Record<string, number> = {};
const stairCache = new Map<number, { terraces: Stair[]; gazebo: { stair: Stair | null; back: [number, number, number, number] | null } | null; flush: Set<number> }>();

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
    if (t.rx <= 0 || t.count < 1) return;
    const R = t.rx + 16 * t.scale, step = (32 * t.scale) / t.rx, halfW = Math.round(STAIR_HALF * Math.max(0.9, t.scale));
    const wall = snap(t.wall), depth = 12;
    // the original placement first (an end facing the viewer, just past the last holder), then ends further round
    // the wall and one more step clear of the holders, so every raised terrace can carry a flight
    const ends = ([[1, t.a1 + 0.5 * step, 0.8], [0, t.a0 - 0.5 * step, 0.8], [1, t.a1 + 0.5 * step, 1.3], [0, t.a0 - 0.5 * step, 1.3], [1, t.a1 + 1.2 * step, 1.3], [0, t.a0 - 1.2 * step, 1.3], [1, t.a1 + 2 * step, 1.45], [0, t.a0 - 2 * step, 1.45]] as const)
      .map(([end, a, tol], k) => ({ end, a, tol, k }))
      .sort((p, q) => (p.tol - q.tol) || (Math.abs(p.a - Math.PI / 2) - Math.abs(q.a - Math.PI / 2)) || p.k - q.k);
    let why = "angle";
    for (const { end, a, tol } of ends) {
      if (Math.abs(a - Math.PI / 2) > tol) continue;
      const x = t.cx + Math.cos(a) * R, yTop = t.cy + Math.sin(a) * R * TILT;
      const drop = wall + depth;
      for (const hw of [halfW, Math.max(7, halfW - 3)]) {
        const box = { l: x - hw - 10, r: x + hw + 10, t: yTop - 6, b: yTop + drop + 4 };
        if (plan.slots.some((s) => boxHit(box, slotBox(s)))) { why = "slot"; continue; }
        if (wet(plan, x, yTop + drop, hw) || x < plan.ox - 20 || x > plan.ox + SECTOR_W + 20) { why = "wet/edge"; continue; }
        const py = pathY(plan.gy, x);
        // a flight whose foot lands on the path is joined to it directly; one with the path across its upper steps is not
        const footOnPath = py > yTop + drop * 0.6 && py < yTop + drop + 26;
        if (!footOnPath && Math.abs(yTop + drop / 2 - py) < 24) { why = "path"; continue; }
        if (plan.gazebo && Math.hypot(plan.gazebo.x - x, (plan.gazebo.y - yTop) / TILT) < 150) { why = "gazebo"; continue; }
        const pad = Math.abs(a - (end ? t.a1 : t.a0)) + (hw + 12) / R;
        const walk: Stair["walk"] = footOnPath ? [x, yTop + drop, x, Math.max(yTop + drop, py)] : walkToPath(plan, x, yTop + drop, 220, x >= t.cx ? 1 : -1, hw);
        terraces.push({ x, yTop, drop, halfW: hw, walk, terrace: ti, pad, end });
        why = "";
        break;
      }
      if (!why) break;
    }
    if (why) WHY[why] = (WHY[why] ?? 0) + 1;
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
  connect(plan, terraces, gazebo);
  // Every terrace drawn raised must be reachable: one whose flight could not be placed, or whose flight has no route
  // to the path (directly or through a connected neighbour), is drawn as a ground-level bed instead and its
  // unreachable flight is dropped. Holder coordinates (candle IDs to positions) never move.
  const flush = new Set<number>();
  plan.terraces.forEach((t, ti) => {
    if (t.rx > 0 && !terraces.some((f) => f.terrace === ti && f.connected)) flush.add(ti);
  });
  const out = { terraces: terraces.filter((f) => f.connected), gazebo, flush };
  stairCache.set(plan.index, out);
  return out;
}

/**
 * Join every flight to the main path. A flight whose straight walk reached the path is connected; others try a
 * longer or two-leg walk to the path, then a walk to the foot of a neighbouring flight that is already connected
 * (repeating until nothing changes), so terraces form a network of steps and landings instead of islands.
 */
function connect(plan: SectorPlan, flights: Stair[], gazebo: { stair: Stair | null; back: [number, number, number, number] | null } | null) {
  for (const f of flights) f.connected = f.walk !== null;
  const routes = (f: Stair, tx: number, ty: number, skip: number[]): [number, number, number, number][] | null => {
    const x0 = f.x, y0 = f.yTop + f.drop;
    if (Math.hypot(tx - x0, ty - y0) < 8) return [];
    if (walkClear(plan, x0, y0, tx, ty, skip)) return [[x0, y0, tx, ty]];
    for (const [cx, cy] of [[x0, ty], [tx, y0]]) // an L: down then across, or across then down
      if (walkClear(plan, x0, y0, cx, cy, skip) && walkClear(plan, cx, cy, tx, ty, skip)) return [[x0, y0, cx, cy], [cx, cy, tx, ty]];
    return null;
  };
  // 1. to the path: wider and longer than the straight walk, in front of or behind the foot
  for (const f of flights) {
    if (f.connected) continue;
    const x0 = f.x, y0 = f.yTop + f.drop;
    for (const dx of [0, -40, 40, -90, 90, -150, 150, -220, 220]) {
      const px = x0 + dx;
      const py = pathY(plan.gy, px) + (pathY(plan.gy, px) > y0 ? -14 : 14);
      if (Math.abs(py - y0) > 420 || px < plan.ox - 10 || px > plan.ox + SECTOR_W + 10) continue;
      const r = routes(f, px, py, [f.terrace]);
      if (r) { f.links = r; f.connected = true; break; }
    }
  }
  // 2. through neighbours: to the foot of the nearest connected flight (or the arches' steps)
  const hubs = () => {
    const h: { x: number; y: number; t: number }[] = [];
    for (const f of flights) {
      if (!f.connected) continue;
      h.push({ x: f.x, y: f.yTop + f.drop, t: f.terrace });
      // points along its walk and legs are landings too: a route may join it midway
      for (const w of [f.walk, ...(f.links ?? [])]) if (w) for (const k of [0.5, 1]) h.push({ x: w[0] + (w[2] - w[0]) * k, y: w[1] + (w[3] - w[1]) * k, t: f.terrace });
    }
    if (gazebo?.stair && (gazebo.stair.walk || gazebo.back)) h.push({ x: gazebo.stair.x, y: gazebo.stair.yTop + gazebo.stair.drop, t: -1 });
    return h;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of flights) {
      if (f.connected) continue;
      const y0 = f.yTop + f.drop;
      const near = hubs().sort((a, b) => Math.hypot(a.x - f.x, a.y - y0) - Math.hypot(b.x - f.x, b.y - y0)).slice(0, 14);
      for (const h of near) {
        if (Math.hypot(h.x - f.x, h.y - y0) > 640) break;
        const r = routes(f, h.x, h.y + 4, [f.terrace, h.t]);
        if (r) { f.links = r; f.connected = true; changed = true; break; }
      }
    }
  }
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
