import {
  HOLDER_TOP, HORIZON_CUT, SECTOR_H, SECTOR_MARGIN, SECTOR_W, TILT, mulberry, pathY, sectorPlan, streamX, type Terrace,
} from "./layout";

type Img = HTMLImageElement | null;
/** Which neighbours exist: [north, east, south, west]. Features run on into a neighbour; at an open edge they end. */
export type Neighbours = [boolean, boolean, boolean, boolean];

/**
 * Static scenery for one sector, drawn in world coordinates onto a canvas that covers the sector plus
 * SECTOR_MARGIN on every side. The ground itself is filled by the renderer in world space, so it has no
 * seams; this layer only adds features, and features that cross an edge (the stream, the path) are
 * world-space curves drawn identically by both neighbours. Back to front: tonal patches, the path, the
 * stream with its pools and waterfall, then terraces, trees, gazebo, bridge and statues sorted by depth.
 * Candles and their light are drawn per frame on top; nothing here depends on purchases.
 */
export function drawSectorArt(g: CanvasRenderingContext2D, index: number, imgs: Record<string, Img>, nb: Neighbours) {
  const plan = sectorPlan(index);
  const { gx, gy, ox, oy } = plan;
  const M = SECTOR_MARGIN, W = SECTOR_W, H = SECTOR_H;
  const r = mulberry(1000 + index * 31);
  const im = (n: string) => imgs[`${n}.webp`] ?? null;
  const ground = im("ground"), stone = im("stone"), ped = im("pedestal"), fall = im("waterfall");
  g.save();
  g.translate(M - ox, M - oy); // from here on, world coordinates; patterns line up across sectors
  const groundPat = ground ? g.createPattern(ground, "repeat") : null;
  const stonePat = stone ? g.createPattern(stone, "repeat") : null;
  const put = (n: string, x: number, yBase: number, h: number, flip = false, alpha = 1) => {
    const s = im(n);
    if (!s) return;
    const w = (h * s.width) / s.height;
    g.globalAlpha = alpha;
    if (flip) {
      g.save(); g.translate(x, 0); g.scale(-1, 1); g.drawImage(s, -w / 2, yBase - h, w, h); g.restore();
    } else g.drawImage(s, x - w / 2, yBase - h, w, h);
    g.globalAlpha = 1;
  };
  const top = oy + (nb[0] ? -M : HORIZON_CUT);

  // land edge toward the vista: an irregular hillside line with a tree line and haze, never a straight cut
  if (!nb[0]) {
    // the band is a function of world x only, and each sector paints it only across its own width where a
    // neighbour continues it, so translucent haze is never laid twice and no seam forms between sectors
    const edge = (x: number) => oy + HORIZON_CUT - 30 - 34 * Math.sin(x / 150) - 22 * Math.sin(x / 61) - 40 * Math.sin(x / 430);
    const bx0 = nb[3] ? ox : ox - M, bx1 = nb[1] ? ox + W : ox + W + M;
    g.save();
    g.beginPath(); g.rect(bx0, oy - M, bx1 - bx0, HORIZON_CUT + M + 120); g.clip();
    // receding hill bands behind the land edge: each farther band is lower in contrast and hazier
    for (let b = 3; b >= 1; b--) {
      const far = (x: number) => edge(x) - 38 * b - 30 * Math.sin(x / (240 - 40 * b) + b * 2.1) * Math.sin(x / 113 + b);
      g.beginPath();
      g.moveTo(ox - M, edge(ox - M) + 20);
      for (let x = ox - M; x <= ox + W + M; x += 14) g.lineTo(x, far(x));
      g.lineTo(ox + W + M, edge(ox + W + M) + 20);
      g.closePath();
      g.fillStyle = ["#0d221c", "#11272a", "#152c35"][b - 1];
      g.fill();
      g.fillStyle = `rgba(90,130,155,${0.06 + 0.07 * b})`;
      g.fill();
      for (let x = bx0 + 20 + r() * 40; x < bx1 - 20; x += 18 + r() * 34) {
        put(r() < 0.4 ? "tree-2" : "tree-0", x, far(x) + 6, (46 - 10 * b) * (0.7 + r() * 0.6), r() < 0.5, 0.55 - 0.1 * b);
      }
      // a far terrace wall and the odd pavilion on the nearer bands
      if (b < 3) {
        g.strokeStyle = `rgba(190,170,120,${0.12 / b})`; g.lineWidth = 1;
        g.beginPath();
        for (let x = ox - M; x <= ox + W + M; x += 14) { const y = far(x) + 12 + 6 * Math.sin(x / 90); x === ox - M ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
        if (r() < 0.8) { const x = ox + 100 + r() * (W - 200); put("gazebo", x, far(x) + 10, 40 / b, false, 0.6); }
      }
    }
    g.beginPath();
    g.moveTo(ox - M, oy + HORIZON_CUT + 80);
    for (let x = ox - M; x <= ox + W + M; x += 16) g.lineTo(x, edge(x));
    g.lineTo(ox + W + M, oy + HORIZON_CUT + 80);
    g.closePath();
    g.fillStyle = groundPat ?? "#0c2117";
    g.fill();
    const fade = g.createLinearGradient(0, oy + HORIZON_CUT - 110, 0, oy + HORIZON_CUT + 80);
    fade.addColorStop(0, "rgba(16,36,44,0.9)");
    fade.addColorStop(0.6, "rgba(10,28,26,0.45)");
    fade.addColorStop(1, "rgba(10,28,26,0)");
    g.fillStyle = fade;
    g.fill();
    for (let x = bx0 + 24 + r() * 30; x < bx1 - 24; x += 26 + r() * 40) {
      put(r() < 0.35 ? "tree-2" : r() < 0.5 ? "tree-1" : "tree-0", x, edge(x) + 8, 50 + r() * 50, r() < 0.5, 0.75);
    }
    g.restore();
  }

  // tonal patches: shadowed hollows and moonlit rises so the lawn never reads as a flat fill
  for (let i = 0; i < 16; i++) {
    const x = ox + r() * W, y = Math.max(top + 60, oy + r() * H), rad = 120 + r() * 220;
    const dark = r() < 0.6;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, dark ? "rgba(0,6,3,0.42)" : "rgba(70,120,120,0.10)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.save(); g.translate(x, y); g.scale(1, TILT * 1.4); g.translate(-x, -y);
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ---- the path: an east-west flagstone walk, warm-lit, running on into the neighbours ----
  const px0 = nb[3] ? ox - M : ox + 30 + r() * 60, px1 = nb[1] ? ox + W + M : ox + W - 30 - r() * 60;
  const band = (pts: [number, number][], half: (i: number) => number, nx: (i: number) => [number, number]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => { const [a, b] = nx(i); const h = half(i); i ? g.lineTo(x + a * h, y + b * h) : g.moveTo(x + a * h, y + b * h); });
    for (let i = pts.length - 1; i >= 0; i--) { const [x, y] = pts[i]; const [a, b] = nx(i); const h = half(i); g.lineTo(x - a * h, y - b * h); }
    g.closePath();
  };
  const pathPts: [number, number][] = [];
  for (let x = px0; x <= px1; x += 12) pathPts.push([x, pathY(gy, x)]);
  const pathNormal = (i: number): [number, number] => {
    const a = pathPts[Math.max(0, i - 1)], b = pathPts[Math.min(pathPts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const pathHalf = (i: number) => {
    const end = Math.min(i, pathPts.length - 1 - i);
    const taper = (!nb[3] && i < 6) || (!nb[1] && pathPts.length - 1 - i < 6) ? Math.max(0.3, end / 6) : 1;
    return 22 * taper;
  };
  drawWalk(g, pathPts, pathHalf, pathNormal, stonePat, band);

  // founding sector: a broad entrance walk from the near left corner up to the hero pedestal and the path
  if (plan.hero) {
    const h = plan.hero;
    const ent: [number, number][] = [];
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const x = (1 - t) ** 3 * (ox - 60) + 3 * (1 - t) ** 2 * t * (ox + 120) + 3 * (1 - t) * t * t * (h.x + 40) + t ** 3 * (h.x + 150);
      const y = (1 - t) ** 3 * (oy + H + 60) + 3 * (1 - t) ** 2 * t * (oy + H - 120) + 3 * (1 - t) * t * t * (h.y + 120) + t ** 3 * pathY(gy, h.x + 150);
      ent.push([x, y]);
    }
    const en = (i: number): [number, number] => {
      const a = ent[Math.max(0, i - 1)], b = ent[Math.min(ent.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    };
    drawWalk(g, ent, (i) => 70 - 46 * (i / 40), en, stonePat, band);
    // round plinth around the hero pedestal
    g.fillStyle = stonePat ?? "#3d3a30";
    g.beginPath(); g.ellipse(h.x, h.y + 6, 92, 92 * TILT, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fill();
    g.strokeStyle = "rgba(214,186,120,0.45)"; g.lineWidth = 2.5; g.stroke();
  }

  // ---- the stream: a moonlit band winding north-south, with pools and a waterfall ----
  const sy0 = nb[0] ? oy - M : oy + HORIZON_CUT - 30, sy1 = nb[2] ? oy + H + M : oy + H - 70;
  const sp: [number, number][] = [];
  for (let y = sy0; y <= sy1; y += 10) sp.push([streamX(gx, y), y]);
  const sn = (i: number): [number, number] => {
    const a = sp[Math.max(0, i - 1)], b = sp[Math.min(sp.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };
  const wHalf = (i: number) => 24 + 7 * Math.sin(sp[i][1] / 83) + 5 * Math.sin(sp[i][1] / 37);
  g.fillStyle = stonePat ?? "#3d3a30";
  band(sp, (i) => wHalf(i) + 11, sn);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.45)";
  g.fill();
  const water = g.createLinearGradient(0, sy0, 0, sy1);
  water.addColorStop(0, "#1f4a62");
  water.addColorStop(0.5, "#123a4e");
  water.addColorStop(1, "#0b2a38");
  g.fillStyle = water;
  band(sp, wHalf, sn);
  g.fill();
  // pools: where the stream slows and widens; the end pool catches it at an open southern edge
  const pools = [...plan.pools];
  if (!nb[2]) pools.push({ x: streamX(gx, sy1), y: sy1, rx: 80 });
  for (const p of pools) {
    g.fillStyle = stonePat ?? "#3d3a30";
    g.beginPath(); g.ellipse(p.x, p.y, p.rx + 12, (p.rx + 12) * TILT, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.4)"; g.fill();
    const pg = g.createRadialGradient(p.x, p.y - 10, 4, p.x, p.y, p.rx);
    pg.addColorStop(0, "#2c5f78"); pg.addColorStop(1, "#0d2f40");
    g.fillStyle = pg;
    g.beginPath(); g.ellipse(p.x, p.y, p.rx, p.rx * TILT, 0, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2, d = p.rx * (0.4 + r() * 0.5);
      g.fillStyle = r() < 0.5 ? "#1f4a2c" : "#2a5a34";
      g.beginPath(); g.ellipse(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * TILT, 9, 4, 0, 0.3, Math.PI * 2 - 0.3); g.fill();
    }
  }
  // moonlight on the water: broken silver strokes along the current
  g.save();
  band(sp, wHalf, sn);
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
    const { x, y } = plan.fall;
    g.fillStyle = stonePat ?? "#3d3a30";
    g.beginPath(); g.ellipse(x, y - 4, 52, 16, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fill();
    if (fall) { g.globalAlpha = 0.9; g.drawImage(fall, x - 30, y - 10, 60, 64); g.globalAlpha = 1; }
    const foam = g.createRadialGradient(x, y + 52, 2, x, y + 52, 46);
    foam.addColorStop(0, "rgba(200,230,245,0.35)"); foam.addColorStop(1, "rgba(200,230,245,0)");
    g.fillStyle = foam; g.fillRect(x - 50, y + 20, 100, 70);
  }

  // ---- depth-sorted features: terraces, trees, gazebo, bridge, statues ----
  type Item = { y: number; draw: () => void };
  const items: Item[] = [];
  for (const t of plan.terraces) items.push({ y: t.cy + t.rx * TILT, draw: () => drawTerrace(g, t, plan.slots, ped, groundPat, stonePat, put, r) });
  const clear = (x: number, y: number, rad: number) => {
    if (Math.abs(x - streamX(gx, y)) < 60 + rad * 0.4 || Math.abs(y - pathY(gy, x)) < 40) return false;
    if (y < top + 30 || x < ox - 40 || x > ox + W + 40 || y > oy + H + 40) return false;
    for (const s of plan.slots) if (Math.abs(s[0] - x) < rad && s[1] - y < rad * 0.9 && s[1] - y > -rad * 0.25) return false;
    if (plan.gazebo && Math.hypot(plan.gazebo.x - x, plan.gazebo.y - y) < 90) return false;
    return true;
  };
  for (let i = 0, placed = 0; i < 260 && placed < 30; i++) {
    const x = ox - 30 + r() * (W + 60), y = oy + r() * H, h = 90 + r() * 110;
    if (!clear(x, y, h * 0.45)) continue;
    placed++;
    const kind = r() < 0.3 ? "tree-2" : r() < 0.5 ? "tree-1" : "tree-0", flip = r() < 0.5;
    items.push({ y, draw: () => put(kind, x, y + 6, h, flip) });
  }
  for (let i = 0, placed = 0; i < 400 && placed < 95; i++) {
    const x = ox - 20 + r() * (W + 40), y = oy + r() * H, h = 26 + r() * 34;
    if (!clear(x, y, 30)) continue;
    placed++;
    const kind = r() < 0.55 ? "bush" : "bush-plain", flip = r() < 0.5;
    items.push({ y, draw: () => put(kind, x, y + 4, h, flip) });
  }
  if (plan.gazebo) { const { x, y } = plan.gazebo; items.push({ y, draw: () => { put("gazebo", x, y + 8, 128); } }); }
  {
    const b = plan.bridge;
    items.push({
      y: b.y + 20,
      draw: () => {
        const s = im("bridge");
        if (s) {
          const w = 150, h = (w * s.height) / s.width;
          g.save(); g.translate(b.x, b.y + 18); g.rotate(b.angle); g.drawImage(s, -w / 2, -h, w, h); g.restore();
        }
        // decorative brass lanterns at the bridge heads: steady and boxed, never mistaken for a candle flame
        for (const side of [-1, 1]) put("lantern", b.x + side * 84, pathY(gy, b.x + side * 84) + 4, 44);
      },
    });
  }
  const frog = im("frog");
  if (frog) {
    const spots: [number, number, number][] = [];
    if (plan.hero) spots.push([plan.hero.x - 150, plan.hero.y + 40, 2.2]);
    for (let i = 0; i < 40 && spots.length < (plan.hero ? 2 : 1); i++) {
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

  if (!nb[0]) {
    const mist = g.createLinearGradient(0, oy + HORIZON_CUT - 80, 0, oy + HORIZON_CUT + 160);
    mist.addColorStop(0, "rgba(120,160,185,0)");
    mist.addColorStop(0.35, "rgba(120,160,185,0.18)");
    mist.addColorStop(1, "rgba(120,160,185,0)");
    g.fillStyle = mist;
    const mx0 = nb[3] ? ox : ox - M, mx1 = nb[1] ? ox + W : ox + W + M; // laid once per column, no double haze
    g.fillRect(mx0, oy + HORIZON_CUT - 80, mx1 - mx0, 240);
  }
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
