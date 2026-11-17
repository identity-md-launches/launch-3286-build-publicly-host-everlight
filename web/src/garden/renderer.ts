import type { Candle } from "../lib/candles";
import {
  SECTOR_H, SECTOR_W, SLOTS_PER_SECTOR, TERRACES, mulberry, positionOf, sectorCount, sectorOrigin, worldBounds,
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
      g.globalAlpha = 0.3;
      g.drawImage(this.glow, x - 60, y - 80, 120, 120);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    for (let p = first; p < first + count; p++) {
      const pos = positionOf(p);
      g.fillStyle = `rgb(${TINT[candles[p].style] ?? TINT[0]})`;
      g.beginPath();
      g.arc(pos.x - ox, pos.y - oy - 20, 10, 0, Math.PI * 2);
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
    const n = sectorCount(input.total);
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
        ctx.arc(p.x, p.y - 20, 40, 0, Math.PI * 2);
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
    const lit: { x: number; y: number; c: Candle }[] = [];
    for (const s of visible) {
      const first = s * SLOTS_PER_SECTOR;
      for (let p = first; p < first + SLOTS_PER_SECTOR; p++) {
        const pos = positionOf(p);
        const c = input.candles[p];
        if (pos.x < tl.x - 60 || pos.x > br.x + 60 || pos.y < tl.y - 100 || pos.y > br.y + 60) continue;
        if (c) lit.push({ x: pos.x, y: pos.y, c });
        else if (p >= input.total) this.drawHolder(pos.x, pos.y);
      }
    }
    // Warm light first, additive and local; strength per candle is fixed so many candles brighten
    // their own neighbourhood without washing out the screen.
    ctx.globalCompositeOperation = "lighter";
    for (const { x, y, c } of lit) {
      const flick = input.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(time / 260 + c.id * 1.7);
      ctx.globalAlpha = 0.22 * flick;
      const r = 80;
      ctx.drawImage(this.glow, x - r, y - 40 - r, r * 2, r * 2);
      // reflection streak on the terrace stone / stream below
      ctx.globalAlpha = 0.1 * flick;
      ctx.drawImage(this.glow, x - 12, y - 4, 24, 56);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (const { x, y, c } of lit) {
      drawn++;
      this.drawCandle(x, y, c, lod === 2 && !input.reducedMotion ? time : 0);
      if (input.selected === c.id || (input.highlightMine && input.mine.has(c.id))) {
        ctx.strokeStyle = input.selected === c.id ? "#fff3c4" : "rgba(232,190,90,0.9)";
        ctx.lineWidth = Math.max(2, 2 / cam.z);
        ctx.beginPath();
        ctx.arc(x, y - 22, 34, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    this.stats = { visibleSectors: visible.length, drawnCandles: drawn, lod, ms: performance.now() - t0 };
    (window as any).__lastFrame = this.stats;
  }

  private drawHolder(x: number, y: number) {
    const im = this.layerImgs["holder.svg"];
    if (im) this.ctx.drawImage(im, x - 14, y - 6, 28, 14);
    else {
      this.ctx.strokeStyle = "#5d6f63";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.ellipse(x, y, 11, 4, 0, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  private drawCandle(x: number, y: number, c: Candle, time: number) {
    const { ctx } = this;
    const im = this.candleImgs[c.style];
    const w = 28, h = 56; // sprite drawn at 0.7 scale of its 40x80 box
    const top = y - h + 4;
    if (im) ctx.drawImage(im, x - w / 2, top, w, h);
    else {
      ctx.fillStyle = "#efe4c4";
      ctx.fillRect(x - 5, top + 14, 10, h - 18);
    }
    const tipY = top + (WICK[c.style] ?? 12) * 0.7;
    const sway = time ? Math.sin(time / 180 + c.id) * 1.6 : 0;
    const stretch = time ? 1 + 0.12 * Math.sin(time / 120 + c.id * 2.3) : 1;
    ctx.save();
    ctx.translate(x, tipY);
    ctx.scale(1, stretch);
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
    const b = worldBounds(input.total);
    const W = m.width, H = m.height;
    const s = Math.min(W / (b.maxX - b.minX), H / (b.maxY - b.minY));
    const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    const oy = (H - (b.maxY - b.minY) * s) / 2 - b.minY * s;
    g.fillStyle = "#06110c";
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < sectorCount(input.total); i++) {
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

/** Static art for one sector, seeded by its index so each terrace is distinct but stable. */
export function drawSectorArt(g: CanvasRenderingContext2D, index: number, imgs: Record<string, Img>) {
  const r = mulberry(1000 + index * 31);
  const W = SECTOR_W, H = SECTOR_H;
  // ground
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#07140f");
  bg.addColorStop(1, "#0a1d15");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // distant hedges / moonlit canopy along the top
  g.fillStyle = "#0b2219";
  for (let x = -40; x < W + 40; x += 60 + r() * 40) {
    g.beginPath();
    g.arc(x, 40 + r() * 50, 50 + r() * 40, 0, Math.PI * 2);
    g.fill();
  }
  // moonlight wash from the upper left
  const moon = g.createRadialGradient(W * 0.2, 0, 10, W * 0.2, 0, W * 0.8);
  moon.addColorStop(0, "rgba(170,200,210,0.10)");
  moon.addColorStop(1, "rgba(170,200,210,0)");
  g.fillStyle = moon;
  g.fillRect(0, 0, W, H);
  // stream winding between the second and third terraces
  g.strokeStyle = "#0f2c2c";
  g.lineWidth = 46;
  g.lineCap = "round";
  const sy = H * 0.57 + (r() - 0.5) * 30;
  g.beginPath();
  g.moveTo(-30, sy);
  for (let x = 0; x <= W + 30; x += 100) g.lineTo(x, sy + Math.sin(x / 140 + index) * 18);
  g.stroke();
  g.strokeStyle = "rgba(160,210,210,0.13)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-30, sy - 6);
  for (let x = 0; x <= W + 30; x += 100) g.lineTo(x, sy - 6 + Math.sin(x / 140 + index) * 18);
  g.stroke();
  // terraces: stone ledges under each candle path
  TERRACES.forEach((t, row) => {
    const y = t * H;
    g.fillStyle = row % 2 ? "#13251d" : "#11231b";
    g.beginPath();
    g.moveTo(0, y + 8);
    for (let x = 0; x <= W; x += 60) g.lineTo(x, y + 8 + Math.sin((x / W) * Math.PI * 2 + row) * 18);
    g.lineTo(W, y + 34);
    g.lineTo(0, y + 34);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(196,170,110,0.18)";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= W; x += 60) g.lineTo(x, y + 8 + Math.sin((x / W) * Math.PI * 2 + row) * 18);
    g.stroke();
  });
  // arches, frogs and flowers
  const arch = imgs["arch.svg"], frog = imgs["frog.svg"], flowers = imgs["flowers.svg"];
  const ax = 120 + r() * (W - 360);
  if (arch) g.drawImage(arch, ax, H * 0.05, 200, 220);
  else {
    g.strokeStyle = "#33463c";
    g.lineWidth = 26;
    g.beginPath();
    g.arc(ax + 100, H * 0.05 + 100, 76, Math.PI, 0);
    g.stroke();
  }
  for (let i = 0; i < 3; i++) {
    const fx = r() * (W - 140), fy = H * (0.35 + i * 0.2) + 6;
    if (frog) g.drawImage(frog, fx, fy, 72, 60);
    else {
      g.fillStyle = "#4a5d51";
      g.beginPath();
      g.ellipse(fx + 36, fy + 40, 30, 20, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let i = 0; i < 9; i++) {
    const fx = r() * (W - 160), fy = H * (0.2 + r() * 0.75);
    if (flowers) g.drawImage(flowers, fx, fy, 130, 65);
    else {
      g.fillStyle = "#e9e1c9";
      for (let k = 0; k < 4; k++) g.fillRect(fx + k * 20, fy + 30 - k * 3, 6, 6);
    }
  }
  // stepping-stone candle path
  g.fillStyle = "rgba(120,130,110,0.16)";
  for (let k = 0; k < 40; k++) {
    g.beginPath();
    g.ellipse(r() * W, H * (0.25 + r() * 0.7), 10 + r() * 8, 4 + r() * 3, 0, 0, Math.PI * 2);
    g.fill();
  }
}
