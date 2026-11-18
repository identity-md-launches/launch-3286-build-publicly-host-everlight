import type { Candle } from "../lib/candles";
import { HOLDER_TOP, HORIZON_CUT, SECTOR_H, SECTOR_MARGIN, SECTOR_W, SLOTS_PER_SECTOR, cameraBounds, horizonY, positionOf, sectorAt, sectorCount, sectorOrigin, spiral, streamX } from "./layout";
import { drawSectorArt } from "./scenery";
import { VISTA_CASTLE_X, VISTA_FOOT, VISTA_H, VISTA_TOP, VISTA_W, makeVista } from "./vista";

export interface Camera { x: number; y: number; z: number }

/** Asset paths are relative to the page so the export works under any gateway subpath. */
export const ART_BASE = new URLSearchParams(location.search).has("noassets") ? "./missing-art/" : "./art/";
const CANDLE_ART = Array.from({ length: 7 }, (_, i) => `candle-${i}.svg`);
const LAYERS = ["pedestal", "tree-0", "tree-1", "tree-2", "bridge", "gazebo", "waterfall", "bush", "bush-plain", "lantern", "ground", "stone", "frog"].map((n) => `${n}.webp`);

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
  /** Cell caches by detail tier (0 overview, 1 mid, 2 near), LRU-bounded. */
  private caches: Map<string, HTMLCanvasElement>[] = [new Map(), new Map(), new Map()];
  /** Cells built per frame are limited; when the budget runs out the frame is redrawn next tick. */
  private budget = 6;
  pending = false;
  private vista: HTMLCanvasElement;
  private groundPat: CanvasPattern | null = null;
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
    this.vista = makeVista();
    Promise.all([...CANDLE_ART.map(loadImage), ...LAYERS.map(loadImage)]).then((imgs) => {
      this.candleImgs = imgs.slice(0, 7);
      LAYERS.forEach((n, i) => (this.layerImgs[n] = imgs[7 + i]));
      this.missingAssets = imgs.filter((i) => !i).length;
      this.caches.forEach((c) => c.clear());
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

  /**
   * Opening view, composed like the approved reference: the founding pedestal (candle #1) stands in the
   * near left at about (0.30 W, 0.77 H) at the head of the entrance walk; the garden recedes behind it to
   * the hillside edge, and the vista with moon and castle fills the top of the screen.
   */
  home() {
    const mobile = this.w < 640;
    const z = mobile ? 0.62 : Math.min(1.1, Math.max(0.5, this.w / 2000));
    const hero = positionOf(0);
    // skyline about a quarter of the way down, the founding pedestal in the near left third
    this.cam = { x: hero.x + (mobile ? 0.12 : 0.2) * (this.w / z), y: HORIZON_CUT + (mobile ? 0.16 : 0.18) * (this.h / z), z };
  }

  toWorld(sx: number, sy: number) {
    return { x: this.cam.x + (sx - this.w / 2) / this.cam.z, y: this.cam.y + (sy - this.h / 2) / this.cam.z };
  }
  toScreen(wx: number, wy: number) {
    return { x: (wx - this.cam.x) * this.cam.z + this.w / 2, y: (wy - this.cam.y) * this.cam.z + this.h / 2 };
  }

  /** Smallest zoom: the whole garden plus its ring of wild forest fits the screen. */
  minZoom(total: number) {
    const b = cameraBounds(total);
    return Math.max(0.04, Math.min(0.6, Math.min(this.w / (b.maxX - b.minX), this.h / (b.maxY - b.minY + 900))));
  }

  /** Camera bounds: the view centre stays over land, and the skyline never drops below 45% of the screen. */
  clamp(total: number) {
    const b = cameraBounds(total);
    this.cam.z = Math.min(4, Math.max(this.minZoom(total), this.cam.z));
    const z = this.cam.z;
    const hw = this.w / 2 / z, hh = this.h / 2 / z;
    const cx0 = b.minX + hw, cx1 = b.maxX - hw;
    this.cam.x = cx0 > cx1 ? (b.minX + b.maxX) / 2 : Math.min(cx1, Math.max(cx0, this.cam.x));
    const cyMin = HORIZON_CUT + (0.05 * this.h) / z;
    const cyMax = Math.max(cyMin, b.maxY - hh);
    this.cam.y = Math.min(cyMax, Math.max(cyMin, this.cam.y));
  }

  /**
   * Pre-render one grid cell's static scenery once. A cell inside the garden (index < count) is cultivated:
   * terraces, holders, gazebo, lanterns. A cell outside it is the same ground, stream and path as wild woodland,
   * so the garden grows into scenery that already joins it, and no edge of the world is a void.
   */
  private cell(index: number, wild: boolean, tier: 0 | 1 | 2): HTMLCanvasElement | null {
    const cache = this.caches[tier];
    const key = `${index}:${wild ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // LRU order
    if (this.budget <= 0) { this.pending = true; return null; }
    this.budget -= tier === 0 ? 1 : tier === 1 ? 2 : 4;
    const scale = [0.125, 0.35, 0.7][tier];
    const c = document.createElement("canvas");
    c.width = Math.round((SECTOR_W + 2 * SECTOR_MARGIN) * scale);
    c.height = Math.round((SECTOR_H + 2 * SECTOR_MARGIN) * scale);
    const g = c.getContext("2d")!;
    g.scale(scale, scale);
    const [, gy] = spiral(index);
    drawSectorArt(g, index, this.layerImgs, [gy > 0, true, true, true], wild);
    if (cache.size >= [600, 70, 24][tier]) cache.delete(cache.keys().next().value!);
    cache.set(key, c);
    return c;
  }

  /** Land: one world-aligned ground texture from the skyline down, under every cell, so nothing shows through. */
  private drawLand(tl: { x: number; y: number }, br: { x: number; y: number }) {
    const { ctx } = this;
    const ground = this.layerImgs["ground.webp"];
    if (ground && !this.groundPat) {
      const tile = document.createElement("canvas");
      tile.width = ground.width; tile.height = ground.height;
      const tg = tile.getContext("2d")!;
      tg.drawImage(ground, 0, 0);
      tg.fillStyle = "rgba(2,8,5,0.5)"; // night shade baked into the tile once
      tg.fillRect(0, 0, tile.width, tile.height);
      this.groundPat = ctx.createPattern(tile, "repeat");
    }
    ctx.fillStyle = this.groundPat ?? "#0c2016";
    const step = Math.max(12, 6 / this.cam.z);
    ctx.beginPath();
    const x0 = tl.x - step, x1 = br.x + step;
    ctx.moveTo(x0, br.y + 50);
    for (let x = x0; x <= x1 + step; x += step) ctx.lineTo(x, horizonY(x) + 30);
    ctx.lineTo(x1 + step, br.y + 50);
    ctx.closePath();
    ctx.fill();
  }

  /** Distant vista in screen space: the only parallax layer. Its foot sits on the world skyline. */
  private drawVista() {
    const { ctx, cam } = this;
    const hy = (HORIZON_CUT - cam.y) * cam.z + this.h / 2; // skyline on screen
    ctx.fillStyle = VISTA_TOP;
    ctx.fillRect(0, 0, this.w, this.h);
    if (hy < -40) return;
    const v = this.vista;
    // scale with zoom like a far layer, but never taller than the visible sky band, so moon and castle stay in view
    const vsMax = (Math.min(Math.max(this.h * 0.7, 320), 760) / VISTA_H) * Math.min(1.25, Math.max(0.62, 0.85 + 0.3 * Math.log2(cam.z + 0.35)));
    const vs = Math.min(vsMax, Math.max(0.3, (hy - 30) / (VISTA_H * 0.78))); // 70px of the band sits under the header
    const tw = VISTA_W * vs, th = VISTA_H * vs;
    const top = hy + 40 * vs - th;
    // parallax: the castle sits right of centre at the opening view and drifts slowly as the camera pans
    let x = (900 - cam.x) * cam.z * 0.12 + this.w * 0.68 - VISTA_CASTLE_X * tw;
    x = (((x % tw) + tw) % tw) - tw;
    for (; x < this.w; x += tw) ctx.drawImage(v, x, top, tw + 1, th);
    ctx.fillStyle = VISTA_FOOT;
    ctx.fillRect(0, top + th - 1, this.w, this.h);
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
    c.width = (SECTOR_W + 2 * SECTOR_MARGIN) * scale;
    c.height = (SECTOR_H + 2 * SECTOR_MARGIN) * scale;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.scale(scale, scale);
    const [sx, sy] = sectorOrigin(index);
    const ox = sx - SECTOR_MARGIN, oy = sy - SECTOR_MARGIN;
    g.globalCompositeOperation = "lighter";
    for (let p = first; p < first + count; p++) {
      const pos = positionOf(p);
      const k = pos.scale;
      g.globalAlpha = 0.3;
      g.drawImage(this.glow, pos.x - ox - 60 * k, pos.y - oy - 104 * k, 120 * k, 120 * k);
    }
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    for (let p = first; p < first + count; p++) {
      const pos = positionOf(p);
      g.fillStyle = `rgb(${TINT[candles[p].style] ?? TINT[0]})`;
      g.beginPath();
      g.arc(pos.x - ox, pos.y - oy - 44 * pos.scale, 10 * pos.scale, 0, Math.PI * 2);
      g.fill();
    }
    this.litCache.set(index, { count, canvas: c });
    return c;
  }

  draw(input: RenderInput, time: number) {
    const t0 = performance.now();
    const { ctx, cam } = this;
    this.budget = 6;
    this.pending = false;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawVista();

    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.w, this.h);
    const extent = Math.max(input.total, input.known);
    const n = sectorCount(extent);
    const M = SECTOR_MARGIN;
    // every grid cell that can paint into the view, garden or wild, in back-to-front rows
    const gx0 = Math.floor((tl.x - M) / SECTOR_W), gx1 = Math.floor((br.x + M) / SECTOR_W);
    const gy0 = Math.max(0, Math.floor((tl.y - M) / SECTOR_H)), gy1 = Math.floor((br.y + M) / SECTOR_H);
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);
    ctx.imageSmoothingEnabled = true;
    this.drawLand(tl, br);
    // LOD: 0 = cached light layers per sector, 1 = sprites, 2 = sprites with animated flames
    const lod = cam.z < 0.3 ? 0 : cam.z < 0.7 ? 1 : 2;
    const tier: 0 | 1 | 2 = cam.z < 0.3 ? 0 : cam.z < 0.75 ? 1 : 2;
    let drawn = 0, cells = 0;
    for (let gy = gy0; gy <= gy1; gy++) {
      const row: number[] = [];
      for (let gx = gx0; gx <= gx1; gx++) {
        const s = sectorAt(gx, gy);
        if (s < 0) continue;
        cells++;
        const c = this.cell(s, s >= n, tier);
        if (c) ctx.drawImage(c, gx * SECTOR_W - M, gy * SECTOR_H - M, SECTOR_W + 2 * M, SECTOR_H + 2 * M);
        if (s < n) row.push(s);
      }
      // candles of this row draw before the next row's cells, so nearer trees and walls occlude them correctly
      drawn += lod === 0 ? this.drawRowLights(row, input) : this.drawRowCandles(row, input, tl, br, lod, time);
    }
    if (input.highlightMine || input.selected) this.drawRings(input);
    ctx.restore();
    (window as any).__gardenFrames = ((window as any).__gardenFrames ?? 0) + 1;
    this.stats = { visibleSectors: cells, drawnCandles: drawn, lod, ms: performance.now() - t0 };
    (window as any).__lastFrame = this.stats;
  }

  private drawRowLights(row: number[], input: RenderInput) {
    let drawn = 0;
    const M = SECTOR_MARGIN;
    for (const s of row) {
      const layer = this.litLayer(s, input.candles);
      if (!layer) continue;
      const [ox, oy] = sectorOrigin(s);
      this.ctx.drawImage(layer, ox - M, oy - M, SECTOR_W + 2 * M, SECTOR_H + 2 * M);
      drawn += Math.max(0, Math.min(SLOTS_PER_SECTOR, input.candles.length - s * SLOTS_PER_SECTOR));
    }
    return drawn;
  }

  private drawRowCandles(row: number[], input: RenderInput, tl: { x: number; y: number }, br: { x: number; y: number }, lod: number, time: number) {
    const { ctx } = this;
    const lit: { x: number; y: number; k: number; c: Candle }[] = [];
    for (const s of row) {
      const first = s * SLOTS_PER_SECTOR;
      for (let p = first; p < first + SLOTS_PER_SECTOR; p++) {
        const c = input.candles[p] ?? (input.extra && input.extra.id === p + 1 ? input.extra : undefined);
        if (!c) continue;
        const pos = positionOf(p);
        if (pos.x < tl.x - 60 || pos.x > br.x + 60 || pos.y < tl.y - 100 || pos.y > br.y + 60) continue; // culling
        lit.push({ x: pos.x, y: pos.y, k: pos.scale, c });
      }
    }
    lit.sort((a, b) => a.y - b.y);
    // warm local light, additive: fixed strength per candle so many candles brighten their own neighbourhood
    ctx.globalCompositeOperation = "lighter";
    for (const { x, y, k, c } of lit) {
      const flick = input.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(time / 260 + c.id * 1.7);
      ctx.globalAlpha = 0.3 * flick;
      const r = 80 * k;
      ctx.drawImage(this.glow, x - r, y - 48 * k - r, r * 2, r * 2);
      ctx.globalAlpha = 0.28 * flick; // warm pool on the stone at the foot of the holder
      ctx.drawImage(this.glow, x - 46 * k, y - 18 * k, 92 * k, 34 * k);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (const { x, y, k, c } of lit) this.drawCandle(x, y, k, c, lod === 2 && !input.reducedMotion ? time : 0);
    return lit.length;
  }

  private drawRings(input: RenderInput) {
    const { ctx, cam } = this;
    const ring = (id: number, color: string) => {
      const p = positionOf(id - 1);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 2 / cam.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y - 44 * p.scale, Math.max(30 * Math.max(p.scale, 0.7), 14 / cam.z), 0, Math.PI * 2);
      ctx.stroke();
    };
    if (input.highlightMine) input.mine.forEach((id) => ring(id, "rgba(232,190,90,0.9)"));
    if (input.selected) ring(input.selected, "#fff3c4");
  }

  /** k is the depth scale of the slot: far terraces hold smaller candles than near ones. */
  private drawCandle(x: number, y: number, k: number, c: Candle, time: number) {
    const { ctx } = this;
    const im = this.candleImgs[c.style];
    const f = 0.5 * k; // sprite drawn at 0.5 x depth scale of its 40x80 box, standing in the pedestal cup
    const w = 40 * f, h = 80 * f;
    const top = y - HOLDER_TOP * k - h + 2 * k;
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
    ctx.scale(k * 1.5, k * 1.5 * stretch);
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

  /** Minimap of the actual world: skyline, wild woodland, garden cells, streams, lit candles and the camera. */
  drawMinimap(m: HTMLCanvasElement, input: RenderInput) {
    const g = m.getContext("2d")!;
    const extent = Math.max(input.total, input.known);
    const b = cameraBounds(extent);
    const top = -200;
    const W = m.width, H = m.height;
    const s = Math.min(W / (b.maxX - b.minX), H / (b.maxY - top));
    const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    const oy = (H - (b.maxY - top) * s) / 2 - top * s;
    g.fillStyle = VISTA_TOP;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#0b1a12"; // wild woodland
    g.fillRect(b.minX * s + ox, HORIZON_CUT * s + oy, (b.maxX - b.minX) * s, (b.maxY - HORIZON_CUT) * s);
    const n = sectorCount(extent);
    g.fillStyle = "#1a4630"; // the garden: one continuous landmass
    for (let i = 0; i < n; i++) {
      const [x, y] = sectorOrigin(i);
      const y0 = y === 0 ? HORIZON_CUT : y;
      g.fillRect(x * s + ox, y0 * s + oy, SECTOR_W * s + 0.6, (y + SECTOR_H - y0) * s + 0.6);
    }
    g.strokeStyle = "#4f93a6"; g.lineWidth = 1;
    for (let gx = Math.floor(b.minX / SECTOR_W); gx * SECTOR_W < b.maxX; gx++) {
      g.beginPath();
      for (let y = HORIZON_CUT; y <= b.maxY; y += 60) { const x = streamX(gx, y); if (y === HORIZON_CUT) g.moveTo(x * s + ox, y * s + oy); else g.lineTo(x * s + ox, y * s + oy); }
      g.stroke();
    }
    g.fillStyle = "#f2c35f";
    const step = input.candles.length > 4000 ? 2 : 1;
    for (let i = 0; i < input.candles.length; i += step) {
      const p = positionOf(i);
      g.fillRect(p.x * s + ox - 0.5, p.y * s + oy - 0.5, 1.5, 1.5);
    }
    if (input.highlightMine) {
      g.fillStyle = "#ffffff";
      input.mine.forEach((id) => { const p = positionOf(id - 1); g.fillRect(p.x * s + ox - 1.5, p.y * s + oy - 1.5, 3, 3); });
    }
    if (input.selected) { const p = positionOf(input.selected - 1); g.fillStyle = "#fff3c4"; g.beginPath(); g.arc(p.x * s + ox, p.y * s + oy, 3, 0, Math.PI * 2); g.fill(); }
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

