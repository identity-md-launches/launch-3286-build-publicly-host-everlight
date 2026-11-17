import {
  DEPTHS, HOLDER_TOP, ROW_COUNTS, SECTOR_H, SECTOR_W, SLOTS_PER_SECTOR, VANISH_X, depthScale, mulberry, pathHalf, positionOf,
  sectorOrigin, terraceHalf, terraceY,
} from "./layout";

type Img = HTMLImageElement | null;

/**
 * Static scenery for one sector, seeded by its index so each scene is distinct but stable. Layer order,
 * back to front: a transparent top band (the distant vista shows through), far hill, gazebo and trees,
 * the stream with a waterfall at every terrace drop, then six terraces from far to near. Each terrace is a
 * textured lawn with a stone retaining wall, its weathered pedestals (the candle holders) and plantings.
 * Candles and their light are drawn per frame on top; nothing here depends on purchases.
 */
export function drawSectorArt(g: CanvasRenderingContext2D, index: number, imgs: Record<string, Img>) {
  const r = mulberry(1000 + index * 31);
  const W = SECTOR_W, H = SECTOR_H, cx = VANISH_X;
  const im = (n: string) => imgs[`${n}.webp`] ?? null;
  const ground = im("ground"), stone = im("stone"), ped = im("pedestal"), fall = im("waterfall");
  const far = terraceY(0) * H;
  const groundPat = ground ? g.createPattern(ground, "repeat") : null;
  const stonePat = stone ? g.createPattern(stone, "repeat") : null;
  const sway = (d: number) => Math.sin(d * 5 + index) * 18 * d; // the stream meanders, more up close

  // hillside behind the far terrace: fades in from transparent so the vista reads between sectors
  const hill = g.createLinearGradient(0, far - 150, 0, far + 10);
  hill.addColorStop(0, "rgba(9,26,18,0)");
  hill.addColorStop(0.55, "rgba(9,26,18,0.85)");
  hill.addColorStop(1, "#0a1d14");
  g.fillStyle = hill;
  g.beginPath();
  g.moveTo(0, far + 10);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, far - 70 - 50 * Math.sin(x / 140 + index) * Math.sin(x / 57 + index * 2));
  g.lineTo(W, far + 10);
  g.closePath();
  g.fill();
  g.fillStyle = groundPat ?? "#0b2116";
  g.fillRect(0, far - 10, W, H - far + 10);
  const shade = g.createLinearGradient(0, far, 0, H);
  shade.addColorStop(0, "rgba(14,34,40,0.55)");
  shade.addColorStop(0.5, "rgba(4,12,8,0.4)");
  shade.addColorStop(1, "rgba(0,0,0,0.3)");
  g.fillStyle = shade;
  g.fillRect(0, far - 10, W, H - far + 10);

  const put = (n: string, x: number, yBase: number, h: number, flip = false) => {
    const s = im(n);
    if (!s) return;
    const w = (h * s.width) / s.height;
    if (flip) {
      g.save(); g.translate(x, 0); g.scale(-1, 1); g.drawImage(s, -w / 2, yBase - h, w, h); g.restore();
    } else g.drawImage(s, x - w / 2, yBase - h, w, h);
  };
  for (let i = 0; i < 9; i++) put(r() < 0.3 ? "tree-2" : r() < 0.5 ? "tree-1" : "tree-0", r() * W, far - 4 + r() * 6, 70 + r() * 50, r() < 0.5);
  put("gazebo", cx + (index % 2 ? 150 : -150), far + 4, 110);

  // stream: a meandering band from the far gate to the near edge, moonlit blue, with a stone bed
  const streamPath = (grow: number) => {
    g.beginPath();
    for (let k = 0; k <= 24; k++) { const d = k / 24; g.lineTo(cx + sway(d) - pathHalf(d) * 0.55 - grow, far + (H - far) * d); }
    for (let k = 24; k >= 0; k--) { const d = k / 24; g.lineTo(cx + sway(d) + pathHalf(d) * 0.55 + grow, far + (H - far) * d); }
    g.closePath();
  };
  g.fillStyle = stonePat ?? "#3d3a30";
  streamPath(10);
  g.fill();
  const water = g.createLinearGradient(0, far, 0, H);
  water.addColorStop(0, "#28506a");
  water.addColorStop(0.4, "#12374a");
  water.addColorStop(1, "#0a2430");
  g.fillStyle = water;
  streamPath(0);
  g.fill();
  g.save();
  streamPath(0);
  g.clip();
  g.strokeStyle = "rgba(190,225,245,0.22)";
  g.lineWidth = 1.4;
  for (let k = 0; k < 60; k++) {
    const d = r(), y = far + (H - far) * d, half = pathHalf(d) * 0.4 * (0.3 + r());
    const x = cx + sway(d) + (r() - 0.5) * pathHalf(d) * 0.8;
    g.beginPath(); g.moveTo(x - half / 2, y); g.lineTo(x + half / 2, y); g.stroke();
  }
  g.restore();

  const [ox, oy] = sectorOrigin(index);
  let first = 0;
  DEPTHS.forEach((d, row) => {
    const sc = depthScale(d);
    const y = terraceY(d) * H;
    const wall = 26 * sc;
    for (const side of [-1, 1]) {
      const inner = cx + sway(d) + side * (pathHalf(d) * 0.55 + 12);
      const outer = cx + side * (terraceHalf(d) + 60 * sc);
      const pts: [number, number][] = [];
      for (let k = 0; k <= 16; k++) {
        const u = k / 16;
        pts.push([inner + (outer - inner) * u, y + 6 * sc - u * u * 16 * sc]);
      }
      const trace = () => pts.forEach(([x, py], k) => (k ? g.lineTo(x, py) : g.moveTo(x, py)));
      // lawn behind the ledge
      g.fillStyle = groundPat ?? "#11231a";
      g.beginPath();
      trace();
      for (let k = pts.length - 1; k >= 0; k--) g.lineTo(pts[k][0], pts[k][1] - 30 * sc);
      g.closePath();
      g.fill();
      // retaining wall: stone courses darkening toward the foot, gold-lit coping
      g.fillStyle = stonePat ?? "#3d3a30";
      g.beginPath();
      trace();
      for (let k = pts.length - 1; k >= 0; k--) g.lineTo(pts[k][0], pts[k][1] + wall);
      g.closePath();
      g.fill();
      const wg = g.createLinearGradient(0, y, 0, y + wall);
      wg.addColorStop(0, "rgba(0,0,0,0.05)");
      wg.addColorStop(1, "rgba(0,0,0,0.6)");
      g.fillStyle = wg;
      g.fill();
      g.strokeStyle = `rgba(214,186,120,${0.22 + 0.2 * d})`;
      g.lineWidth = 1 + 1.4 * sc;
      g.beginPath();
      trace();
      g.stroke();
      put(r() < 0.5 ? "bush" : "bush-plain", outer - side * 30 * sc, y + 4 * sc, 60 * sc, side < 0);
      // planted slope below the wall: shrubs and white flowers, denser toward the outer ends
      for (let k = 0; k < 5; k++) {
        const u = 0.15 + r() * 0.85;
        put(r() < 0.55 ? "bush" : "bush-plain", inner + (outer - inner) * u, y + wall + (14 + r() * 26) * sc, (34 + r() * 26) * sc, r() < 0.5);
      }
      if (row % 2 === 0) put(r() < 0.4 ? "tree-2" : "tree-0", outer + side * 10 * sc, y - 6 * sc, 160 * sc, side > 0);
    }
    if (fall) {
      const fw = pathHalf(d) * 1.1, fh = wall * 2.4;
      g.globalAlpha = 0.85;
      g.drawImage(fall, cx + sway(d) - fw / 2, y - 4 * sc, fw, fh);
      g.globalAlpha = 1;
    }
    if (row === 1 || row === 4) put("bridge", cx + sway(d), y + wall * 0.9, 90 * sc);
    // decorative brass lanterns at the path heads: steady and boxed, never mistaken for a candle flame
    if (row === 3) for (const side of [-1, 1]) put("lantern", cx + sway(d) + side * (pathHalf(d) * 0.55 + 22), y + 2, 54 * sc);
    // the candle holders of this terrace, at the exact slot positions candles use
    for (let s = first; s < first + ROW_COUNTS[row]; s++) {
      const p = positionOf(index * SLOTS_PER_SECTOR + s);
      drawPedestal(g, ped, p.x - ox, p.y - oy, p.scale);
    }
    first += ROW_COUNTS[row];
  });
  const frog = im("frog");
  if (frog) {
    const d = DEPTHS[1], sc = depthScale(d), y = terraceY(d) * H;
    for (const side of [-1, 1]) {
      const x = cx + sway(d) + side * (pathHalf(d) * 0.55 + 40);
      g.save(); g.translate(x, y - 2); if (side > 0) g.scale(-1, 1);
      g.drawImage(frog, -24 * sc, -40 * sc, 48 * sc, 41 * sc);
      g.restore();
    }
  }
  const mist = g.createLinearGradient(0, far - 20, 0, far + 140);
  mist.addColorStop(0, "rgba(120,160,180,0.16)");
  mist.addColorStop(1, "rgba(120,160,180,0)");
  g.fillStyle = mist;
  g.fillRect(0, far - 20, W, 160);
}

/** One empty holder: a weathered stone pedestal whose cup sits HOLDER_TOP above the slot point. */
export function drawPedestal(g: CanvasRenderingContext2D, ped: Img, x: number, y: number, k: number) {
  const h = 34 * k, w = h * 0.8;
  if (ped) g.drawImage(ped, x - w / 2, y + 4 * k - h, w, h);
  else {
    g.fillStyle = "#4a463a";
    g.fillRect(x - 8 * k, y - HOLDER_TOP * k, 16 * k, HOLDER_TOP * k);
  }
}
