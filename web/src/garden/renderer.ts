import type { Candle } from "../lib/candles";
import {
  DEPTHS, SECTOR_H, SECTOR_W, SLOTS_PER_SECTOR, VANISH_X, depthScale, mulberry, pathHalf, positionOf, sectorCount, sectorOrigin,
  terraceHalf, terraceY, worldBounds,
} from "./layout";

export interface Camera { x: number; y: number; z: number }

/** Asset paths are relative to the page so the export works under any gateway subpath. */
export const ART_BASE = new URLSearchParams(location.search).has("noassets") ? "./missing-art/" : "./art/";
const CANDLE_ART = Array.from({ length: 7 }, (_, i) => `candle-${i}.svg`);
const LAYERS = ["arch.svg", "frog.svg", "flowers.svg", "holder.svg"] as const;

/** Flame tip offsets per style (fraction of 80-unit sprite height) and glow tint. */
const WICK = [12, 12, 22, 30, 12, 22, 36];
const TINT = ["255,214,150", "255,170,80", "255,206,110", "255,226,190", "255,200,90", "220,236,170", "200,255,236"];

type Img = HTMLImageElement | null;

function loadImage(src: string): Promise<Img> {
  return new Promise((res) => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => res(im);
    im.onerror = () => res(null); // missing asset: the renderer falls back to drawn shapes
    im.src = ART_BASE + src;
  });
}

export interface RenderInput {
  total: number;
  known: number;
  extra?: Candle | null;
  candles: Candle[];
  selected: number | null;
  mine: Set<number>;
  highlightMine: boolean;
  reducedMotion: boolean;
}

export interface FrameStats { visibleSectors: number; drawnCandles: number; lod: number; ms: number }

export class GardenRenderer {
  cam: Camera = { x: SECTOR_W / 2, y: SECTOR_H / 2, z: 1 };
  private ctx: CanvasRenderingContext2D;
  private candleImgs: Img[] = [];
  private layerImgs: Record<string, Img> = {};
  private sectorCache = new Map<number, HTMLCanvasElement>();
  private sectorLowCache = new Map<number, HTMLCanvasElement>();
  private litCache = new Map<number, { count: number; canvas: HTMLCanvasElement }>();
  private glow: HTMLCanvasElement;
  missingAssets = 0;
  stats: FrameStats = { visibleSectors: 0, drawnCandles: 0, lod: 0, ms: 0 };
  private dpr = 1;
  w = 0;
  h = 0;

  constructor(private canvas: HTMLCanvasElement, onReady: () => void) {
    this.ctx = canvas.getContext("2d")!;
    this.glow = makeGlow();
    Promise.all([...CANDLE_ART.map(loadImage), ...LAYERS.map(loadImage)]).then((imgs) => {
      this.candleImgs = imgs.slice(0, 7);
      LAYERS.forEach((n, i) => (this.layerImgs[n] = imgs[7 + i]));
      this.missingAssets = imgs.filter((i) => !i).length;
      this.sectorCache.clear();
      this.sectorLowCache.clear();
      onReady();
    });
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  toWorld(sx: number, sy: number) {
    return { x: this.cam.x + (sx - this.w / 2) / this.cam.z, y: this.cam.y + (sy - this.h / 2) / this.cam.z };
  }
  toScreen(wx: number, wy: number) {
    return { x: (wx - this.cam.x) * this.cam.z + this.w / 2, y: (wy - this.cam.y) * this.cam.z + this.h / 2 };
  }

  clamp(total: number) {
    const b = worldBounds(total);
    this.cam.z = Math.min(4, Math.max(0.06, this.cam.z));
    this.cam.x = Math.min(b.maxX, Math.max(b.minX, this.cam.x));
    this.cam.y = Math.min(b.maxY, Math.max(b.minY, this.cam.y));
  }

  /** Pre-render one sector's static layers once (terraces, stream, arches, frogs, flowers, holders). */
  private sector(index: number, low = false): HTMLCanvasElement {
    const cache = low ? this.sectorLowCache : this.sectorCache;
    const hit = cache.get(index);
    if (hit) return hit;
    const scale = low ? 0.125 : 0.5;
    const c = document.createElement("canvas");
    c.width = SECTOR_W * scale;
    c.height = SECTOR_H * scale;
    const g = c.getContext("2d")!;
    g.scale(scale, scale);
    drawSectorArt(g, index, this.layerImgs);
    if (!low && cache.size > 48) cache.delete(cache.keys().next().value!);
    cache.set(index, c);
    return c;
  }

  /** Overview LOD: one pre-rendered light layer per sector, rebuilt only when that sector gains candles. */
  private litLayer(index: number, candles: Candle[]): HTMLCanvasElement | null {
    const first = index * SLOTS_PER_SECTOR;
    const count = Math.max(0, Math.min(SLOTS_PER_SECTOR, candles.length - first));
    if (count === 0) return null;
    const hit = this.litCache.get(index);
    if (hit && hit.count === count) return hit.canvas;
    const scale = 0.25;
    const c = hit?.canvas ?? document.createElement("canvas");
    c.width = SECTOR_W * scale;
    c.height = SECTOR_H * scale;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.scale(scale, scale);
    const [ox, oy] = sectorOrigin(index);
    g.globalCompositeOperation = "lighter";
    for (let p = first; p < first + count; p++) {
      const pos = positionOf(p);
      const x = pos.x - ox, y = pos.y - oy;
      const k = pos.scale;
      g.globalAlpha = 0.3;
      g.drawImage(this.glow, x - 60 * k, y - 80 * k, 120 * k, 120 * k);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    for (let p = first; p < first + count; p++) {
      const pos = positionOf(p);
      g.fillStyle = `rgb(${TINT[candles[p].style] ?? TINT[0]})`;
      g.beginPath();
      g.arc(pos.x - ox, pos.y - oy - 20 * pos.scale, 10 * pos.scale, 0, Math.PI * 2);
      g.fill();
    }
    this.litCache.set(index, { count, canvas: c });
    return c;
  }

  draw(input: RenderInput, time: number) {
    const t0 = performance.now();
    const { ctx, cam } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Night sky behind everything
    const sky = ctx.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, "#040a08");
    sky.addColorStop(1, "#071510");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);

    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.w, this.h);
    const extent = Math.max(input.total, input.known);
    const n = sectorCount(extent);
    const visible: number[] = [];
    for (let s = 0; s < n; s++) {
      const [ox, oy] = sectorOrigin(s);
      if (ox + SECTOR_W < tl.x || ox > br.x || oy + SECTOR_H < tl.y || oy > br.y) continue; // viewport culling
      visible.push(s);
    }
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);
    ctx.imageSmoothingEnabled = true;
    // LOD: 0 = cached light layers per sector, 1 = sprites, 2 = sprites with animated flames
    const lod = cam.z < 0.3 ? 0 : cam.z < 0.7 ? 1 : 2;
    for (const s of visible) {
      const [ox, oy] = sectorOrigin(s);
      ctx.drawImage(this.sector(s, lod === 0), ox, oy, SECTOR_W, SECTOR_H);
    }
    (window as any).__gardenFrames = ((window as any).__gardenFrames ?? 0) + 1;
    if (lod === 0) {
      let drawn = 0;
      for (const s of visible) {
        const layer = this.litLayer(s, input.candles);
        if (!layer) continue;
        const [ox, oy] = sectorOrigin(s);
        ctx.drawImage(layer, ox, oy, SECTOR_W, SECTOR_H);
        drawn += Math.max(0, Math.min(SLOTS_PER_SECTOR, input.candles.length - s * SLOTS_PER_SECTOR));
      }
      const ring = (id: number, color: string) => {
        const p = positionOf(id - 1);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / cam.z;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 20 * p.scale, 40 * Math.max(p.scale, 0.8), 0, Math.PI * 2);
        ctx.stroke();
      };
      if (input.highlightMine) input.mine.forEach((id) => ring(id, "rgba(232,190,90,0.9)"));
      if (input.selected) ring(input.selected, "#fff3c4");
      ctx.restore();
      this.stats = { visibleSectors: visible.length, drawnCandles: drawn, lod, ms: performance.now() - t0 };
    (window as any).__lastFrame = this.stats;
      return;
    }
    let drawn = 0;
    const lit: { x: number; y: number; k: number; c: Candle }[] = [];
    for (const s of visible) {
      const first = s * SLOTS_PER_SECTOR;
      for (let p = first; p < first + SLOTS_PER_SECTOR; p++) {
        const pos = positionOf(p);
        const c = input.candles[p] ?? (input.extra && input.extra.id === p + 1 ? input.extra : undefined);
        if (pos.x < tl.x - 60 || pos.x > br.x + 60 || pos.y < tl.y - 100 || pos.y > br.y + 60) continue;
        if (c) lit.push({ x: pos.x, y: pos.y, k: pos.scale, c });
        else if (p >= extent) this.drawHolder(pos.x, pos.y, pos.scale);
      }
    }
    // Warm light first, additive and local; strength per candle is fixed so many candles brighten
    // their own neighbourhood without washing out the screen.
    ctx.globalCompositeOperation = "lighter";
    for (const { x, y, k, c } of lit) {
      const flick = input.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(time / 260 + c.id * 1.7);
      ctx.globalAlpha = 0.22 * flick;
      const r = 80 * k;
      ctx.drawImage(this.glow, x - r, y - 40 * k - r, r * 2, r * 2);
      // reflection streak on the terrace stone / stream below
      ctx.globalAlpha = 0.1 * flick;
      ctx.drawImage(this.glow, x - 12 * k, y - 4 * k, 24 * k, 56 * k);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (const { x, y, k, c } of lit) {
      drawn++;
      this.drawCandle(x, y, k, c, lod === 2 && !input.reducedMotion ? time : 0);
      if (input.selected === c.id || (input.highlightMine && input.mine.has(c.id))) {
        ctx.strokeStyle = input.selected === c.id ? "#fff3c4" : "rgba(232,190,90,0.9)";
        ctx.lineWidth = Math.max(2, 2 / cam.z);
        ctx.beginPath();
        ctx.arc(x, y - 22 * k, 34 * Math.max(k, 0.7), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    this.stats = { visibleSectors: visible.length, drawnCandles: drawn, lod, ms: performance.now() - t0 };
    (window as any).__lastFrame = this.stats;
  }

  private drawHolder(x: number, y: number, k: number) {
    const im = this.layerImgs["holder.svg"];
    if (im) this.ctx.drawImage(im, x - 14 * k, y - 6 * k, 28 * k, 14 * k);
    else {
      this.ctx.strokeStyle = "#5d6f63";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.ellipse(x, y, 11 * k, 4 * k, 0, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  /** k is the depth scale of the slot: far terraces hold smaller candles than near ones. */
  private drawCandle(x: number, y: number, k: number, c: Candle, time: number) {
    const { ctx } = this;
    const im = this.candleImgs[c.style];
    const f = 0.7 * k; // sprite drawn at 0.7 x depth scale of its 40x80 box
    const w = 40 * f, h = 80 * f;
    const top = y - h + 4 * k;
    if (im) ctx.drawImage(im, x - w / 2, top, w, h);
    else {
      ctx.fillStyle = "#efe4c4";
      ctx.fillRect(x - 5 * k, top + 14 * k, 10 * k, h - 18 * k);
    }
    const tipY = top + (WICK[c.style] ?? 12) * f;
    const sway = time ? Math.sin(time / 180 + c.id) * 1.6 : 0;
    const stretch = time ? 1 + 0.12 * Math.sin(time / 120 + c.id * 2.3) : 1;
    ctx.save();
    ctx.translate(x, tipY);
    ctx.scale(k, k * stretch);
    const fg = ctx.createRadialGradient(0, -3, 0.5, 0, -4, 9);
    fg.addColorStop(0, "#fffbe8");
    fg.addColorStop(0.35, `rgb(${TINT[c.style] ?? TINT[0]})`);
    fg.addColorStop(1, "rgba(255,140,40,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.quadraticCurveTo(6, -2, sway, -14);
    ctx.quadraticCurveTo(-6, -2, 0, 2);
    ctx.fill();
    ctx.restore();
  }

  /** Draw the overview used by the minimap: sectors as tiles, lit candles as points, viewport frame. */
  drawMinimap(m: HTMLCanvasElement, input: RenderInput) {
    const g = m.getContext("2d")!;
    const extent = Math.max(input.total, input.known);
    const b = worldBounds(extent);
    const W = m.width, H = m.height;
    const s = Math.min(W / (b.maxX - b.minX), H / (b.maxY - b.minY));
    const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    const oy = (H - (b.maxY - b.minY) * s) / 2 - b.minY * s;
    g.fillStyle = "#06110c";
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < sectorCount(extent); i++) {
      const [x, y] = sectorOrigin(i);
      g.fillStyle = "#123323";
      g.fillRect(x * s + ox + 0.5, y * s + oy + 0.5, SECTOR_W * s - 1, SECTOR_H * s - 1);
    }
    g.fillStyle = "#f2c35f";
    const step = input.candles.length > 4000 ? 2 : 1;
    for (let i = 0; i < input.candles.length; i += step) {
      const p = positionOf(i);
      g.fillRect(p.x * s + ox - 0.5, p.y * s + oy - 0.5, 1.5, 1.5);
    }
    if (input.highlightMine) {
      g.fillStyle = "#ffffff";
      input.mine.forEach((id) => {
        const p = positionOf(id - 1);
        g.fillRect(p.x * s + ox - 1.5, p.y * s + oy - 1.5, 3, 3);
      });
    }
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    g.strokeStyle = "#fff3c4";
    g.lineWidth = 1.5;
    g.strokeRect(tl.x * s + ox, tl.y * s + oy, (br.x - tl.x) * s, (br.y - tl.y) * s);
    return { s, ox, oy };
  }
}

function makeGlow() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,200,110,0.9)");
  r.addColorStop(0.25, "rgba(255,170,70,0.35)");
  r.addColorStop(1, "rgba(255,140,40,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/**
 * Static art for one sector, seeded by its index so each scene is distinct but stable. The scene
 * recedes to a moonlit gate at the top centre: canopy and mist in the distance, a stream and
 * stepping-stone path down the middle, terraces on both banks that widen toward the viewer, and
 * large arches and frog sculptures framing the near edges.
 */
export function drawSectorArt(g: CanvasRenderingContext2D, index: number, imgs: Record<string, Img>) {
  const r = mulberry(1000 + index * 31);
  const W = SECTOR_W, H = SECTOR_H, cx = VANISH_X;
  const arch = imgs["arch.svg"], frog = imgs["frog.svg"], flowers = imgs["flowers.svg"];
  const far = terraceY(0) * H;
  // ground: darker and mistier in the distance, a little more emerald up close
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#040b08");
  bg.addColorStop(0.25, "#07140f");
  bg.addColorStop(1, "#0c2118");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // moon glow behind the far gate
  const moon = g.createRadialGradient(cx, far * 0.45, 8, cx, far * 0.45, W * 0.55);
  moon.addColorStop(0, "rgba(190,214,220,0.16)");
  moon.addColorStop(0.3, "rgba(170,200,210,0.06)");
  moon.addColorStop(1, "rgba(170,200,210,0)");
  g.fillStyle = moon;
  g.fillRect(0, 0, W, H);
  // distant canopy: small, low-contrast silhouettes along the horizon
  g.fillStyle = "#0a1d15";
  for (let x = -30; x < W + 30; x += 34 + r() * 30) {
    g.beginPath();
    g.arc(x, far - 30 - r() * 26, 22 + r() * 22, 0, Math.PI * 2);
    g.fill();
  }
  // nearer hedges at the sides, larger
  g.fillStyle = "#0b2219";
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const d = k / 5;
      const x = cx + side * (terraceHalf(d) + 40 + r() * 30);
      g.beginPath();
      g.arc(x, terraceY(d) * H - 30 * depthScale(d), (40 + r() * 20) * depthScale(d), 0, Math.PI * 2);
      g.fill();
    }
  }
  // the far gate the path recedes into
  const gw = 96, gh = 106;
  if (arch) g.drawImage(arch, cx - gw / 2, far - gh + 6, gw, gh);
  // stream: a tapered band from the gate to the near edge
  const stream = (inset: number) => {
    g.beginPath();
    g.moveTo(cx - pathHalf(0) + inset, far);
    for (let k = 0; k <= 10; k++) { const d = k / 10; g.lineTo(cx - pathHalf(d) * 0.62 + inset + Math.sin(d * 5 + index) * 10 * d, terraceY(d) * H); }
    g.lineTo(cx - pathHalf(1) * 0.7 + inset, H);
    g.lineTo(cx + pathHalf(1) * 0.7 - inset, H);
    for (let k = 10; k >= 0; k--) { const d = k / 10; g.lineTo(cx + pathHalf(d) * 0.62 - inset + Math.sin(d * 5 + index) * 10 * d, terraceY(d) * H); }
    g.closePath();
  };
  const water = g.createLinearGradient(0, far, 0, H);
  water.addColorStop(0, "#1a3a3a");
  water.addColorStop(1, "#0d2a2b");
  g.fillStyle = water;
  stream(0);
  g.fill();
  // moonlight shimmer on the water, denser in the distance
  g.strokeStyle = "rgba(190,225,225,0.16)";
  g.lineWidth = 1.5;
  for (let k = 0; k < 26; k++) {
    const d = Math.pow(r(), 1.3);
    const y = terraceY(d) * H + (r() - 0.5) * 20;
    const half = pathHalf(d) * 0.45 * r();
    const x = cx + Math.sin(d * 5 + index) * 10 * d + (r() - 0.5) * pathHalf(d) * 0.6;
    g.beginPath();
    g.moveTo(x - half * 0.5, y);
    g.lineTo(x + half * 0.5, y);
    g.stroke();
  }
  // stepping-stone path along the stream banks, shrinking with distance
  g.fillStyle = "rgba(150,160,135,0.22)";
  for (const side of [-1, 1]) {
    for (let k = 0; k < 18; k++) {
      const d = k / 17;
      const sc = depthScale(d);
      const x = cx + side * (pathHalf(d) * 0.62 + 6 + 8 * sc) + Math.sin(d * 5 + index) * 10 * d;
      g.beginPath();
      g.ellipse(x, terraceY(d) * H + 10 * sc, 9 * sc, 3.5 * sc, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // terraces: a stone ledge on each bank under every candle row, thicker and wider up close
  DEPTHS.forEach((d, row) => {
    const sc = depthScale(d);
    const y = terraceY(d) * H;
    const inner = pathHalf(d) + 4;
    const outer = terraceHalf(d) + 30 * sc;
    for (const side of [-1, 1]) {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 12; k++) {
        const u = k / 12;
        pts.push([cx + side * (inner + u * (outer - inner)), y + 4 * sc - u * u * 16 * sc]);
      }
      g.fillStyle = row % 2 ? "#13261d" : "#11231a";
      g.beginPath();
      pts.forEach(([x, py], k) => (k ? g.lineTo(x, py) : g.moveTo(x, py)));
      for (let k = pts.length - 1; k >= 0; k--) g.lineTo(pts[k][0], pts[k][1] + 22 * sc);
      g.closePath();
      g.fill();
      g.strokeStyle = `rgba(196,170,110,${0.1 + 0.14 * d})`;
      g.lineWidth = 1 + 1.5 * sc;
      g.beginPath();
      pts.forEach(([x, py], k) => (k ? g.lineTo(x, py) : g.moveTo(x, py)));
      g.stroke();
    }
  });
  // flowers between terraces, scaled by depth
  for (let i = 0; i < 12; i++) {
    const d = r();
    const sc = depthScale(d);
    const side = r() < 0.5 ? -1 : 1;
    const x = cx + side * (pathHalf(d) + 20 + r() * (terraceHalf(d) - pathHalf(d)));
    const y = terraceY(d) * H + 18 * sc;
    const w = 110 * sc, h = 55 * sc;
    if (flowers) g.drawImage(flowers, x - w / 2, y, w, h);
    else {
      g.fillStyle = "#e9e1c9";
      for (let k = 0; k < 4; k++) g.fillRect(x + k * 14 * sc, y + 20 * sc - k * 2, 4 * sc, 4 * sc);
    }
  }
  // small frog sculptures guarding the far banks
  for (const side of [-1, 1]) {
    const d = 0.25 + r() * 0.1, sc = depthScale(d);
    const x = cx + side * (pathHalf(d) * 0.62 + 18 * sc) - 30 * sc;
    const y = terraceY(d) * H - 34 * sc;
    if (frog) g.drawImage(frog, x, y, 60 * sc, 50 * sc);
  }
  // near frame: arches straddle each sector edge (neighbouring sectors complete them) and large frogs sit at the near corners
  const aw = 280, ah = 308, ay = H * 0.38;
  if (arch) {
    g.drawImage(arch, -aw / 2, ay, aw, ah);
    g.drawImage(arch, W - aw / 2, ay, aw, ah);
  }
  const fw = 150, fh = 125;
  if (frog) {
    g.drawImage(frog, 6, H - fh - 4, fw, fh);
    g.save();
    g.translate(W - 6, H - fh - 4);
    g.scale(-1, 1);
    g.drawImage(frog, 0, 0, fw, fh);
    g.restore();
  } else {
    g.fillStyle = "#4a5d51";
    for (const x of [6 + fw / 2, W - 6 - fw / 2]) {
      g.beginPath();
      g.ellipse(x, H - fh / 2, fw * 0.4, fh * 0.3, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // near-edge vignette: deepens the foreground frame without dimming the candles drawn later
  const vig = g.createRadialGradient(cx, H * 0.45, H * 0.35, cx, H * 0.55, W * 0.75);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.38)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
}
