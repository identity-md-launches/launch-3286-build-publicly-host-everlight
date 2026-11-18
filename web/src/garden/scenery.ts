import {
  HOLDER_TOP, HORIZON_CUT, horizonY, SECTOR_H, SECTOR_MARGIN, SECTOR_W, TILT, mulberry, pathY, sectorAt, sectorPlan, streamX, type SectorPlan, type Terrace,
} from "./layout";

type Img = HTMLImageElement | null;

/** Overdraw of the flat layer past its own cell, in world units: hides antialiased seams; both sides paint the same curves there. */
export const BASE_PAD = 4;
/** Stream head in a home-row column: a spring well below the skyline, never a cut at the cell's top edge. */
export function springY(gx: number): number {
  let y = HORIZON_CUT + 60;
  for (let i = 0; i < 5; i++) y = horizonY(streamX(gx, y)) + 95;
  return Math.round(y);
}

type Put = (n: string, x: number, yBase: number, h: number, flip?: boolean, alpha?: number) => void;
function sprites(g: CanvasRenderingContext2D, imgs: Record<string, Img>) {
  const im = (n: string) => imgs[`${n}.webp`] ?? null;
  const put: Put = (n, x, yBase, h, flip = false, alpha = 1) => {
    const s = im(n);
    if (!s) return;
    const w = (h * s.width) / s.height;
    g.globalAlpha = alpha;
    if (flip) {
      g.save(); g.translate(x, 0); g.scale(-1, 1); g.drawImage(s, -w / 2, yBase - h, w, h); g.restore();
    } else g.drawImage(s, x - w / 2, yBase - h, w, h);
    g.globalAlpha = 1;
  };
  const width = (n: string, h: number) => { const s = im(n); return s ? (h * s.width) / s.height : h; };
  return { im, put, width };
}

const band = (g: CanvasRenderingContext2D, pts: [number, number][], half: (i: number) => number, nx: (i: number) => [number, number]) => {
  g.beginPath();
  pts.forEach(([x, y], i) => { const [a, b] = nx(i); const h = half(i); i ? g.lineTo(x + a * h, y + b * h) : g.moveTo(x + a * h, y + b * h); });
  for (let i = pts.length - 1; i >= 0; i--) { const [x, y] = pts[i]; const [a, b] = nx(i); const h = half(i); g.lineTo(x - a * h, y - b * h); }
  g.closePath();
};
const normals = (pts: [number, number][]) => (i: number): [number, number] => {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
};

/**
 * Flat layer of one cell, drawn in world coordinates onto a canvas covering exactly the cell plus BASE_PAD.
 * Everything here either stays wholly inside the cell (tonal patches, ground cover) or is a world-space curve
 * (path, stream, pools of this and the neighbouring cells, the founding entrance walk) that every cell it
 * crosses paints identically, clipped to itself. No cell's flat layer ever covers a neighbour's, so paths and
 * streams run through cell joins without a step, an offset or a straight cut.
 */
export function drawSectorBase(g: CanvasRenderingContext2D, index: number, imgs: Record<string, Img>, wild = false) {
  const plan = sectorPlan(index);
  const { gx, gy, ox, oy } = plan;
  const W = SECTOR_W, H = SECTOR_H, P = BASE_PAD;
  const r = mulberry(1000 + index * 31);
  const { im, put, width } = sprites(g, imgs);
  const stone = im("stone"), fall = im("waterfall");
  g.save();
  g.translate(P - ox, P - oy);
  const stonePat = stone ? g.createPattern(stone, "repeat") : null;
  const top = oy + (gy > 0 ? 0 : HORIZON_CUT);

  // tonal patches: shadowed hollows and moonlit rises, each wholly inside this cell
  for (let i = 0; i < 16; i++) {
    const rad = 100 + r() * 70, x = ox + rad + r() * (W - 2 * rad);
    const y = Math.min(oy + H - rad * 0.6, Math.max(top + 60, oy + rad * 0.6, oy + r() * H));
    const dark = r() < 0.6;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, dark ? "rgba(0,6,3,0.42)" : "rgba(70,120,120,0.10)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.save(); g.translate(x, y); g.scale(1, TILT * 1.4); g.translate(-x, -y);
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ground cover under the path and stream: low shrubs, flowering bushes, cypresses and mossy rocks,
  // only where the whole sprite fits inside this cell
  const inside = (x: number, y: number, w: number, h: number) => x - w / 2 > ox + 2 && x + w / 2 < ox + W - 2 && y - h > oy + 2 && y + 4 < oy + H;
  for (let i = 0; i < 70; i++) {
    const x = ox - 40 + r() * (W + 80), y = top + 90 + r() * (oy + H - top - 90);
    const kind = r();
    const th = kind < 0.12 ? 70 + r() * 60 : 90 + r() * 70;
    const name = kind < 0.12 ? "tree-2" : kind < 0.24 ? "tree-0" : kind < 0.62 ? "bush-plain" : kind < 0.8 ? "bush" : "";
    const h = kind < 0.24 ? th : kind < 0.62 ? 26 + r() * 30 : 24 + r() * 26;
    const flip = r() < 0.5;
    if (name) {
      if (inside(x, y, width(name, h), h)) put(name, x, y, h, flip, kind < 0.24 ? 0.9 : 0.95);
    } else {
      const rr = 8 + r() * 16;
      if (!inside(x, y, rr * 2, rr * 1.4)) continue;
      const gr = g.createRadialGradient(x - rr * 0.3, y - rr * 0.5, 1, x, y - rr * 0.3, rr);
      gr.addColorStop(0, "#5b5747"); gr.addColorStop(0.6, "#2a2a22"); gr.addColorStop(1, "#0e0f0c");
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y - rr * 0.3, rr, rr * 0.6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(30,80,46,0.6)"; g.beginPath(); g.ellipse(x - rr * 0.2, y - rr * 0.7, rr * 0.6, rr * 0.22, 0, 0, Math.PI * 2); g.fill();
    }
  }

  // ---- the path: one east-west flagstone walk per row, sampled on a world-aligned grid so every cell paints the same polygon ----
  const pathPts: [number, number][] = [];
  for (let x = Math.floor((ox - 48) / 24) * 24; x <= ox + W + 48; x += 12) pathPts.push([x, pathY(gy, x)]);
  drawWalk(g, pathPts, () => 22, normals(pathPts), stonePat, (a, b, c) => band(g, a, b, c));

  // founding entrance walk and forecourt: a world feature that crosses cells (0,0), (-1,0), (0,1) and (-1,1)
  const hero = sectorPlan(0).hero;
  if (hero && gx >= -1 && gx <= 0 && gy <= 1 && !(wild && gx === 0 && gy === 0)) {
    const x0 = -60, y0 = SECTOR_H + 60;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.beginPath(); g.ellipse(x0, y0, 128, 128 * TILT, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = stonePat ?? "#4a463a";
    g.beginPath(); g.ellipse(x0, y0, 120, 120 * TILT, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(150,120,70,0.16)"; g.fill();
    g.strokeStyle = "rgba(214,186,120,0.3)"; g.lineWidth = 2; g.stroke();
    const ent: [number, number][] = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const x = (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * 120 + 3 * (1 - t) * t * t * (hero.x + 40) + t ** 3 * (hero.x + 150);
      const y = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * (SECTOR_H - 120) + 3 * (1 - t) * t * t * (hero.y + 120) + t ** 3 * pathY(0, hero.x + 150);
      ent.push([x, y]);
    }
    drawWalk(g, ent, (i) => 70 - 46 * (i / 40), normals(ent), stonePat, (a, b, c) => band(g, a, b, c));
    // round plinth around the hero pedestal
    g.fillStyle = stonePat ?? "#3d3a30";
    g.beginPath(); g.ellipse(hero.x, hero.y + 6, 92, 92 * TILT, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fill();
    g.strokeStyle = "rgba(214,186,120,0.45)"; g.lineWidth = 2.5; g.stroke();
  }

  // ---- the stream: one moonlit band per column, from a spring below the skyline down through every row ----
  const head = gy === 0 ? springY(gx) : -Infinity;
  const sy0 = Math.max(head, Math.floor((oy - 20) / 10) * 10), sy1 = oy + H + 20;
  const sp: [number, number][] = [];
  for (let y = sy0; y <= sy1; y += 10) sp.push([streamX(gx, y), y]);
  const sn = normals(sp);
  const ramp = (y: number) => (gy === 0 ? Math.min(1, 0.3 + (0.7 * (y - head)) / 140) : 1);
  const wHalf = (i: number) => (24 + 7 * Math.sin(sp[i][1] / 83) + 5 * Math.sin(sp[i][1] / 37)) * ramp(sp[i][1]);
  g.fillStyle = stonePat ?? "#3d3a30";
  band(g, sp, (i) => wHalf(i) + 11, sn);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fill();
  // water shade is a function of world y, so it matches across rows
  const water = g.createLinearGradient(0, oy - 20, 0, oy + H + 20);
  water.addColorStop(0, "#173f55");
  water.addColorStop(0.5, "#123a4e");
  water.addColorStop(1, "#173f55");
  g.fillStyle = water;
  band(g, sp, wHalf, sn);
  g.fill();
  // pools of this cell and of the cells above and below that reach into it, each seeded by its own position
  const pools: SectorPlan["pools"] = [];
  for (const dy of [-1, 0, 1]) {
    const s = sectorAt(gx, gy + dy);
    if (s >= 0) pools.push(...sectorPlan(s).pools);
  }
  if (gy === 0) {
    const x = streamX(gx, head);
    pools.push({ x, y: head, rx: 46 });
  }
  for (const p of pools) {
    if (p.y + (p.rx + 12) * TILT < oy - P || p.y - (p.rx + 12) * TILT > oy + H + P) continue;
    const pr = mulberry(Math.round(p.x * 7 + p.y * 13));
    g.fillStyle = stonePat ?? "#3d3a30";
    g.beginPath(); g.ellipse(p.x, p.y, p.rx + 12, (p.rx + 12) * TILT, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.4)"; g.fill();
    const pg = g.createRadialGradient(p.x, p.y - 10, 4, p.x, p.y, p.rx);
    pg.addColorStop(0, "#2c5f78"); pg.addColorStop(1, "#0d2f40");
    g.fillStyle = pg;
    g.beginPath(); g.ellipse(p.x, p.y, p.rx, p.rx * TILT, 0, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 7; k++) {
      const a = pr() * Math.PI * 2, d = p.rx * (0.4 + pr() * 0.5);
      g.fillStyle = pr() < 0.5 ? "#1f4a2c" : "#2a5a34";
      g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * TILT, 9, 4, 0, 0.3, Math.PI * 2 - 0.3); g.fill();
    }
  }
  // the spring: a mossy rock outcrop at the head pool with a short cascade spilling into it
  if (gy === 0) {
    const x = streamX(gx, head);
    // a cluster of dark, moss-capped boulders, back to front, with the cascade spilling from between them
    for (const [dx, dy, rx, ry] of [[-30, -30, 30, 20], [28, -32, 26, 18], [0, -40, 22, 15], [-46, -14, 20, 12], [44, -16, 18, 11]]) {
      const bx = x + dx, by = head + dy;
      const rock = g.createRadialGradient(bx - rx * 0.3, by - ry * 0.5, 2, bx, by, rx);
      rock.addColorStop(0, "#4a473b"); rock.addColorStop(0.55, "#24241d"); rock.addColorStop(1, "#0b0c09");
      g.fillStyle = rock;
      g.beginPath(); g.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(34,86,50,0.6)";
      g.beginPath(); g.ellipse(bx - rx * 0.15, by - ry * 0.6, rx * 0.6, ry * 0.3, 0, 0, Math.PI * 2); g.fill();
    }
    if (fall) { g.globalAlpha = 0.85; g.drawImage(fall, x - 13, head - 34, 26, 36); g.globalAlpha = 1; }
  }
  // moonlight on the water: broken silver strokes along the current
  g.save();
  band(g, sp, wHalf, sn);
  g.clip();
  g.strokeStyle = "rgba(190,225,245,0.24)";
  g.lineWidth = 1.4;
  for (let k = 0; k < 70; k++) {
    const i = (r() * sp.length) | 0, [x, y] = sp[i], half = wHalf(i) * (0.2 + r() * 0.5);
    const off = (r() - 0.5) * wHalf(i);
    g.beginPath(); g.moveTo(x + off - half / 2, y); g.lineTo(x + off + half / 2, y + 1); g.stroke();
  }
  g.restore();
  // waterfall: a rock sill across the stream with the fall and foam below it
  {
    // in the home row the spring is the stream's head, so the sector's fall sits well downstream of it
    const y = gy === 0 ? Math.max(plan.fall.y, head + 150) : plan.fall.y, x = streamX(gx, y);
    // never on the bridge: where the shifted fall would meet it, the spring's cascade is this column's waterfall
    const onBridge = y !== plan.fall.y && Math.abs(y - plan.bridge.y) < 140;
    if (!onBridge) {
    g.fillStyle = stonePat ?? "#3d3a30";
    g.beginPath(); g.ellipse(x, y - 4, 52, 16, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fill();
    if (fall) { g.globalAlpha = 0.9; g.drawImage(fall, x - 30, y - 10, 60, 64); g.globalAlpha = 1; }
    const foam = g.createRadialGradient(x, y + 52, 2, x, y + 52, 46);
    foam.addColorStop(0, "rgba(200,230,245,0.22)"); foam.addColorStop(1, "rgba(200,230,245,0)");
    g.fillStyle = foam; g.beginPath(); g.ellipse(x, y + 52, 46, 30, 0, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

/**
 * Upright layer of one cell on a canvas covering the cell plus SECTOR_MARGIN: terraces, holders, trees,
 * bushes, gazebo, bridge and statues, depth-sorted. Every sprite is drawn whole (never clipped), so where
 * it overhangs a neighbour it reads as a tree in front, not as a patch.
 */
export function drawSectorUpright(g: CanvasRenderingContext2D, index: number, imgs: Record<string, Img>, wild = false) {
  const plan = sectorPlan(index);
  const { gx, gy, ox, oy } = plan;
  const M = SECTOR_MARGIN, W = SECTOR_W, H = SECTOR_H;
  const r = mulberry(5000 + index * 31);
  const { im, put } = sprites(g, imgs);
  const ground = im("ground"), stone = im("stone"), ped = im("pedestal");
  g.save();
  g.translate(M - ox, M - oy);
  const groundPat = ground ? g.createPattern(ground, "repeat") : null;
  const stonePat = stone ? g.createPattern(stone, "repeat") : null;
  const top = oy + (gy > 0 ? 0 : HORIZON_CUT);
  /** Anything drawn must stay inside this cell's canvas (cell + margin). */
  const fits = (y: number, h: number) => y - h > oy - M + 6 && y < oy + H + M - 6;

  // home row: a tree line along the skyline, each tree whole, only across this cell's own width
  if (gy === 0) {
    for (let x = ox + 6 + r() * 20; x < ox + W - 6; x += 14 + r() * 24) {
      put(r() < 0.35 ? "tree-2" : r() < 0.5 ? "tree-1" : "tree-0", x, oy + horizonY(x) + 10 + r() * 14, 40 + r() * 60, r() < 0.5, 0.85);
    }
  }

  type Item = { y: number; draw: () => void };
  const items: Item[] = [];
  if (!wild) for (const t of plan.terraces) items.push({ y: t.cy + t.rx * TILT, draw: () => drawTerrace(g, t, plan.slots, ped, groundPat, stonePat, put, r) });
  const spring = gy === 0 ? springY(gx) : -Infinity;
  const clear = (x: number, y: number, rad: number) => {
    if (Math.abs(x - streamX(gx, y)) < 60 + rad * 0.4 || Math.abs(y - pathY(gy, x)) < 40) return false;
    if (y < top + 30 || x < ox - 40 || x > ox + W + 40 || y > oy + H + 40) return false;
    if (gy === 0 && Math.abs(x - streamX(gx, spring)) < 90 && y < spring + 30 && y > spring - 60) return false;
    if (!wild) for (const s of plan.slots) if (Math.abs(s[0] - x) < rad && s[1] - y < rad * 0.9 && s[1] - y > -rad * 0.25) return false;
    if (!wild && plan.gazebo && Math.hypot(plan.gazebo.x - x, plan.gazebo.y - y) < 90) return false;
    return true;
  };
  // wild cells (beyond the lit garden) are dense old woodland; near their northern edge trees stay low so
  // they never hide the candles of the garden row behind them
  const wildH = (y: number, h: number) => (wild ? Math.min(h, 40 + Math.max(0, y - oy) * 0.75) : h);
  for (let i = 0, placed = 0; i < (wild ? 700 : 260) && placed < (wild ? 90 : 30); i++) {
    const x = ox - 30 + r() * (W + 60), y = oy + r() * H, h = wildH(y, 90 + r() * 110);
    if (!fits(y + 6, h) || !clear(x, y, h * 0.45)) continue;
    placed++;
    const kind = r() < 0.3 ? "tree-2" : r() < 0.5 ? "tree-1" : "tree-0", flip = r() < 0.5;
    items.push({ y, draw: () => put(kind, x, y + 6, h, flip) });
  }
  for (let i = 0, placed = 0; i < (wild ? 900 : 400) && placed < (wild ? 220 : 95); i++) {
    const x = ox - 20 + r() * (W + 40), y = oy + r() * H, h = 26 + r() * 34;
    if (!fits(y + 4, h) || !clear(x, y, 30)) continue;
    placed++;
    const kind = r() < 0.55 ? "bush" : "bush-plain", flip = r() < 0.5;
    items.push({ y, draw: () => put(kind, x, y + 4, h, flip) });
  }
  if (plan.gazebo && !wild) { const { x, y } = plan.gazebo; items.push({ y, draw: () => { put("gazebo", x, y + 8, 128); } }); }
  {
    const b = plan.bridge;
    items.push({
      y: b.y + 20,
      draw: () => {
        // walkable deck: the same flagstone band as the path, carried across the stream so both approaches
        // meet it and no water shows through the crossing
        const deck: [number, number][] = [];
        for (let x = b.x - 88; x <= b.x + 88; x += 8) deck.push([x, pathY(gy, x)]);
        drawWalk(g, deck, () => 24, normals(deck), stonePat, (a, c, d) => band(g, a, c, d));
        const s = im("bridge");
        if (s) {
          // front elevation: its deck line (30% down the sprite) sits on the walk's front edge, so the
          // parapet edges the deck and the arches hang below it over the stream, which shows through them
          const w = 176, h = (w * s.height) / s.width;
          g.save(); g.translate(b.x, b.y + 20); g.rotate(b.angle); g.drawImage(s, -w / 2, -0.3 * h, w, h); g.restore();
        }
        // decorative brass lanterns at the bridge heads: steady and boxed, never mistaken for a candle flame
        if (!wild) for (const side of [-1, 1]) put("lantern", b.x + side * 84, pathY(gy, b.x + side * 84) + 4, 44);
      },
    });
  }
  const frog = im("frog");
  if (frog) {
    const spots: [number, number, number][] = [];
    if (plan.hero && !wild) spots.push([plan.hero.x - 150, plan.hero.y + 40, 2.2]);
    for (let i = 0; i < 40 && spots.length < (plan.hero && !wild ? 2 : 1); i++) {
      const x = ox + 80 + r() * (W - 160);
      const y = pathY(gy, x) + (r() < 0.5 ? -52 : 58);
      if (clear(x, y, 30)) spots.push([x, y, 1]);
    }
    spots.forEach(([x, y, k], i) => items.push({
      y,
      draw: () => {
        g.save(); g.translate(x, y); if (i % 2) g.scale(-1, 1);
        g.drawImage(frog, -30 * k, -50 * k, 60 * k, 51 * k);
        g.restore();
      },
    }));
  }
  items.sort((a, b) => a.y - b.y).forEach((it) => it.draw());
  g.restore();
}

function drawWalk(
  g: CanvasRenderingContext2D, pts: [number, number][], half: (i: number) => number, nx: (i: number) => [number, number],
  stonePat: CanvasPattern | null, band: (pts: [number, number][], half: (i: number) => number, nx: (i: number) => [number, number]) => void,
) {
  if (pts.length < 2) return;
  g.fillStyle = "rgba(0,0,0,0.35)";
  band(pts, (i) => half(i) + 6, nx);
  g.fill();
  g.fillStyle = stonePat ?? "#4a463a";
  band(pts, half, nx);
  g.fill();
  g.fillStyle = "rgba(150,120,70,0.16)";
  g.fill();
  // flagstone joints across the walk
  g.strokeStyle = "rgba(10,12,8,0.45)";
  g.lineWidth = 1.2;
  for (let i = 1; i < pts.length - 1; i += 2) {
    const [x, y] = pts[i], [a, b] = nx(i), h = half(i);
    g.beginPath(); g.moveTo(x + a * h, y + b * h); g.lineTo(x - a * h, y - b * h); g.stroke();
  }
  g.strokeStyle = "rgba(214,186,120,0.18)";
  g.lineWidth = 1;
  band(pts, half, nx);
  g.stroke();
}

function drawTerrace(
  g: CanvasRenderingContext2D, t: Terrace, slots: [number, number, number][], ped: Img,
  groundPat: CanvasPattern | null, stonePat: CanvasPattern | null,
  put: (n: string, x: number, y: number, h: number, flip?: boolean, alpha?: number) => void, r: () => number,
) {
  if (t.rx > 0) {
    const pad = 0.16, depth = 46 * t.scale;
    const outer: [number, number][] = [], inner: [number, number][] = [];
    for (let k = 0; k <= 24; k++) {
      const a = t.a0 - pad + ((t.a1 - t.a0 + 2 * pad) * k) / 24;
      outer.push([t.cx + Math.cos(a) * (t.rx + 16 * t.scale), t.cy + Math.sin(a) * (t.rx + 16 * t.scale) * TILT]);
      inner.push([t.cx + Math.cos(a) * (t.rx - depth), t.cy + Math.sin(a) * (t.rx - depth) * TILT]);
    }
    const trace = (pts: [number, number][], dy = 0, rev = false) => {
      const list = rev ? [...pts].reverse() : pts;
      list.forEach(([x, y], k) => (k || rev ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)));
    };
    // retaining wall: courses of weathered stone below the ledge, darkening toward the foot
    g.beginPath(); trace(outer); trace(outer, t.wall, true); g.closePath();
    g.fillStyle = stonePat ?? "#3d3a30";
    g.fill();
    const wg = g.createLinearGradient(0, t.cy, 0, t.cy + t.rx * TILT + t.wall);
    wg.addColorStop(0, "rgba(0,0,0,0.15)");
    wg.addColorStop(1, "rgba(0,0,0,0.62)");
    g.fillStyle = wg;
    g.fill();
    // the raised lawn behind the ledge
    g.beginPath(); trace(outer); trace(inner, 0, true); g.closePath();
    g.fillStyle = groundPat ?? "#11231a";
    g.fill();
    g.fillStyle = "rgba(40,80,60,0.18)";
    g.fill();
    // gold-lit coping along the ledge
    g.beginPath(); trace(outer);
    g.strokeStyle = "rgba(214,186,120,0.42)";
    g.lineWidth = 1.2 + 1.4 * t.scale;
    g.stroke();
    // plantings: shrubs behind the holders, white flowers at the wall foot
    for (let k = 0; k < Math.max(2, t.count / 4); k++) {
      const [x, y] = inner[(r() * inner.length) | 0];
      put(r() < 0.5 ? "bush" : "bush-plain", x, y + 6 * t.scale, (30 + r() * 22) * t.scale, r() < 0.5);
    }
    for (let k = 0; k < Math.max(1, t.count / 6); k++) {
      const [x, y] = outer[(r() * outer.length) | 0];
      put("bush", x, y + t.wall + 10 * t.scale, (22 + r() * 14) * t.scale, r() < 0.5, 0.9);
    }
  }
  const mine = slots.slice(t.first, t.first + t.count).sort((a, b) => a[1] - b[1]);
  for (const [x, y, k] of mine) drawPedestal(g, ped, x, y, k);
}

/** One empty holder: a weathered stone pedestal whose cup sits HOLDER_TOP above the slot point. */
export function drawPedestal(g: CanvasRenderingContext2D, ped: Img, x: number, y: number, k: number) {
  const h = 34 * k, w = h * 0.8;
  g.fillStyle = "rgba(0,0,0,0.35)";
  g.beginPath(); g.ellipse(x, y + 3 * k, w * 0.6, w * 0.22, 0, 0, Math.PI * 2); g.fill();
  if (ped) g.drawImage(ped, x - w / 2, y + 4 * k - h, w, h);
  else {
    g.fillStyle = "#4a463a";
    g.fillRect(x - 8 * k, y - HOLDER_TOP * k, 16 * k, HOLDER_TOP * k);
  }
}
