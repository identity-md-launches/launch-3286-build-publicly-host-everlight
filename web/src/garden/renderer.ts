import type { Candle } from "../lib/candles";
import { HOLDER_TOP, HORIZON_CUT, SECTOR_H, SECTOR_MARGIN, SECTOR_W, SLOTS_PER_SECTOR, neighbours, positionOf, sectorCount, sectorOrigin, worldBounds } from "./layout";
import { drawSectorArt } from "./scenery";

export interface Camera { x: number; y: number; z: number }

/** Asset paths are relative to the page so the export works under any gateway subpath. */
export const ART_BASE = new URLSearchParams(location.search).has("noassets") ? "./missing-art/" : "./art/";
const CANDLE_ART = Array.from({ length: 7 }, (_, i) => `candle-${i}.svg`);
const LAYERS = ["backdrop", "pedestal", "tree-0", "tree-1", "tree-2", "bridge", "gazebo", "waterfall", "bush", "bush-plain", "lantern", "ground", "stone", "frog"].map((n) => `${n}.webp`);

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
  private sectorCache = new Map<string, HTMLCanvasElement>();
  private sectorLowCache = new Map<string, HTMLCanvasElement>();
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

  /**
   * Opening view, composed like the approved reference: the founding pedestal (candle #1) stands in the
   * near left at about (0.30 W, 0.77 H) at the head of the entrance walk; the garden recedes behind it to
   * the hillside edge, and the vista with moon and castle fills the top of the screen.
   */
  home() {
    const mobile = this.w < 640;
    const z = mobile ? 0.62 : Math.min(1.1, Math.max(0.5, this.w / 2000));
    const hero = positionOf(0);
    this.cam = mobile
      ? { x: hero.x + 0.2 * (this.w / z), y: 400, z }
      : { x: hero.x + 0.2 * (this.w / z), y: hero.y - 0.27 * (this.h / z), z }; // land edge near mid-screen, vista above
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
    this.cam.y = Math.min(b.maxY, Math.max(b.minY - 200, this.cam.y));
  }

  /** Pre-render one sector's static layers once (terraces, stream, arches, frogs, flowers, holders). */
  private sector(index: number, count: number, low = false): HTMLCanvasElement {
    const cache = low ? this.sectorLowCache : this.sectorCache;
    const nb = neighbours(index, count);
    const key = `${index}:${nb.map(Number).join("")}`; // rebuilt when a neighbour appears and features run on into it
    const hit = cache.get(key);
    if (hit) return hit;
    const scale = low ? 0.125 : 0.7;
    const c = document.createElement("canvas");
    c.width = Math.round((SECTOR_W + 2 * SECTOR_MARGIN) * scale);
    c.height = Math.round((SECTOR_H + 2 * SECTOR_MARGIN) * scale);
    const g = c.getContext("2d")!;
    g.scale(scale, scale);
    drawSectorArt(g, index, this.layerImgs, nb);
    if (cache.size > (low ? 400 : 20)) cache.delete(cache.keys().next().value!);
    cache.set(key, c);
    return c;
  }

  /** Ground: one world-aligned texture under every sector, so neighbouring sectors share it without a seam. */
  private drawGround(visible: number[], count: number, lod: number) {
    const { ctx } = this;
    const ground = this.layerImgs["ground.webp"];
    if (ground && !this.groundPat) {
      // night: the lawn sits in near-black shadow so candlelight and moonlit water carry the scene;
      // the shade is baked into the tile once instead of a second full-screen pass per frame
      const tile = document.createElement("canvas");
      tile.width = ground.width; tile.height = ground.height;
      const tg = tile.getContext("2d")!;
      tg.drawImage(ground, 0, 0);
      tg.fillStyle = "rgba(2,8,5,0.5)";
      tg.fillRect(0, 0, tile.width, tile.height);
      this.groundPat = ctx.createPattern(tile, "repeat");
    }
    ctx.fillStyle = lod === 0 || !this.groundPat ? "#0c2016" : this.groundPat;
    for (const s of visible) {
      const [ox, oy] = sectorOrigin(s);
      const nb = neighbours(s, count);
      const y0 = nb[0] ? oy : oy + HORIZON_CUT + 40;
      ctx.fillRect(ox - 1, y0 - 1, SECTOR_W + 2, oy + SECTOR_H - y0 + 2);
    }

    // open edges of the garden fade into the night instead of ending on a drawn line
    const F = 220;
    for (const s of visible) {
      const [ox, oy] = sectorOrigin(s);
      const nb = neighbours(s, count);
      const y0 = nb[0] ? oy : oy + HORIZON_CUT + 40;
      const edge = (x0: number, y0e: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
        const gr = ctx.createLinearGradient(x0, y0e, x1, y1);
        gr.addColorStop(0, "rgba(6,19,12,0)");
        gr.addColorStop(1, "rgba(6,19,12,0.96)");
        ctx.fillStyle = gr;
        ctx.fillRect(rx, ry, rw, rh);
      };
      if (!nb[2]) edge(0, oy + SECTOR_H - F, 0, oy + SECTOR_H, ox - 1, oy + SECTOR_H - F, SECTOR_W + 2, F + 1);
      if (!nb[1]) edge(ox + SECTOR_W - F, 0, ox + SECTOR_W, 0, ox + SECTOR_W - F, y0, F + 1, oy + SECTOR_H - y0);
      if (!nb[3]) edge(ox + F, 0, ox, 0, ox - 1, y0, F + 1, oy + SECTOR_H - y0);
    }
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
      const x = pos.x - ox, y = pos.y - oy;
      const k = pos.scale;
      g.globalAlpha = 0.3;
      g.drawImage(this.glow, x - 60 * k, y - 104 * k, 120 * k, 120 * k);
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
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Distant vista (sky, moon, hills, castle) in screen space with slight parallax; sectors draw over it.
    ctx.fillStyle = "#06130c";
    ctx.fillRect(0, 0, this.w, this.h);
    const bd = this.layerImgs["backdrop.webp"];
    if (bd) {
      const bh = Math.max(this.h * 0.82, (this.w * 1.08 * bd.height) / bd.width);
      const bw = (bh * bd.width) / bd.height;
      const px = Math.max(0, Math.min(bw - this.w, (bw - this.w) * 0.62 - (cam.x - SECTOR_W / 2) * 0.02 * cam.z));
      const py = Math.min(0, -((cam.y - 300) * 0.04 * cam.z));
      ctx.drawImage(bd, -px, py, bw, bh);
      const fade = ctx.createLinearGradient(0, py + bh * 0.8, 0, py + bh);
      fade.addColorStop(0, "rgba(6,19,12,0)");
      fade.addColorStop(1, "#06130c");
      ctx.fillStyle = fade;
      ctx.fillRect(0, py + bh * 0.8, this.w, bh * 0.2 + 1);
    }

    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.w, this.h);
    const extent = Math.max(input.total, input.known);
    const n = sectorCount(extent);
    const visible: number[] = [];
    for (let s = 0; s < n; s++) {
      const [ox, oy] = sectorOrigin(s);
      const M = SECTOR_MARGIN;
      if (ox + SECTOR_W + M < tl.x || ox - M > br.x || oy + SECTOR_H + M < tl.y || oy - M > br.y) continue; // viewport culling
      visible.push(s);
    }
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);
    ctx.imageSmoothingEnabled = true;
    // LOD: 0 = cached light layers per sector, 1 = sprites, 2 = sprites with animated flames
    const lod = cam.z < 0.3 ? 0 : cam.z < 0.7 ? 1 : 2;
    this.drawGround(visible, n, lod);
    const M = SECTOR_MARGIN;
    for (const s of visible) {
      const [ox, oy] = sectorOrigin(s);
      ctx.drawImage(this.sector(s, n, lod === 0), ox - M, oy - M, SECTOR_W + 2 * M, SECTOR_H + 2 * M);
    }
    (window as any).__gardenFrames = ((window as any).__gardenFrames ?? 0) + 1;
    if (lod === 0) {
      let drawn = 0;
      for (const s of visible) {
        const layer = this.litLayer(s, input.candles);
        if (!layer) continue;
        const [ox, oy] = sectorOrigin(s);
        ctx.drawImage(layer, ox - M, oy - M, SECTOR_W + 2 * M, SECTOR_H + 2 * M);
        drawn += Math.max(0, Math.min(SLOTS_PER_SECTOR, input.candles.length - s * SLOTS_PER_SECTOR));
      }
      const ring = (id: number, color: string) => {
        const p = positionOf(id - 1);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / cam.z;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 44 * p.scale, 40 * Math.max(p.scale, 0.8), 0, Math.PI * 2);
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
      }
    }
    // Warm light first, additive and local; strength per candle is fixed so many candles brighten
    // their own neighbourhood without washing out the screen.
    ctx.globalCompositeOperation = "lighter";
    for (const { x, y, k, c } of lit) {
      const flick = input.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(time / 260 + c.id * 1.7);
      ctx.globalAlpha = 0.34 * flick;
      const r = 80 * k;
      ctx.drawImage(this.glow, x - r, y - 48 * k - r, r * 2, r * 2);
      // warm pool on the terrace stone and pedestal faces around the holder
      ctx.globalAlpha = 0.3 * flick;
      ctx.drawImage(this.glow, x - 46 * k, y - 18 * k, 92 * k, 34 * k);
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
        ctx.arc(x, y - 44 * k, 30 * Math.max(k, 0.7), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    this.stats = { visibleSectors: visible.length, drawnCandles: drawn, lod, ms: performance.now() - t0 };
    (window as any).__lastFrame = this.stats;
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
      g.fillRect(x * s + ox, y * s + oy, SECTOR_W * s + 0.5, SECTOR_H * s + 0.5); // one continuous landmass
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

