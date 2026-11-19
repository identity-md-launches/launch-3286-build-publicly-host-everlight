import type { Candle } from "../lib/candles";
import { HOLDER_TOP, HORIZON_CUT, SECTOR_H, SECTOR_MARGIN, SECTOR_W, SLOTS_PER_SECTOR, cameraBounds, horizonY, positionOf, sectorAt, sectorCount, sectorOrigin, streamX } from "./layout";
import { BASE_PAD, PX, drawSectorBase, drawSectorUpright, springY, streamHalf, type Sheet } from "./scenery";
import { ignition } from "./ignite";
import { CASTLE_BOXES, CASTLE_W, MOON_AT, MOON_R, VISTA_CASTLE_X, VISTA_FOOT, VISTA_H, VISTA_TOP, VISTA_W, makeVista, type Vista } from "./vista";

export interface Camera { x: number; y: number; z: number }

/** Closest zoom: the near cache tier paints at 1.0, so scenery is never stretched more than 1.8x (CSS pixels). */
export const MAX_ZOOM = 1.8;
/**
 * Cache tiers by zoom: cells are always painted at the art resolution (1 art pixel = PX world units), then kept
 * whole (tier 2) or reduced by 2 or 4 for far views. Scale of the cached bitmaps per world unit, and LRU size.
 */
const TIER_SCALE = [0.125, 0.25, 0.5];
const TIER_KEEP = [400, 60, 26];
const TIER_COST = [2, 3, 3];
const tierOf = (z: number) => (z < 0.22 ? 0 : z < 0.45 ? 1 : 2);
interface CellArt { base: HTMLCanvasElement; up: HTMLCanvasElement }

/** Asset paths are relative to the page so the export works under any gateway subpath. */
export const ART_BASE = new URLSearchParams(location.search).has("noassets") ? "./missing-art/" : "./art/";
const CANDLE_ART = Array.from({ length: 7 }, (_, i) => `px/candle-${i}.png`);
const FLAME_ART = Array.from({ length: 4 }, (_, i) => `px/flame-${i}.png`);
const TILES = ["tile-grass", "tile-grass-dark", "tile-path", "tile-wall", "tile-moss-stone", "tile-water-0"];
const PROPS = ["holder", "pedestal-hero", "lamp", "arch", "willow", "tree", "cypress", "bush", "bush-flower", "flowers", "lilypad", "lilypad-flower", "vine", "rock", "frog-reader", "frog-wanderer", "frog-gardener", "frog-sitter", "glow"];
const LAYERS = [...TILES, ...PROPS].map((n) => `px/${n}.png`);

/** Wick row per style in its 10x16 sprite (art pixels from the top), and glow tint. */
const WICK = [1, 4, 8, 8, 2, 5, 8];
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
  private flameImgs: Img[] = [];
  private sheet: Sheet = { img: {}, tiles: {} };
  /** Cell caches by detail tier (0 overview, 1 mid, 2 near, 3 close), LRU-bounded. */
  private caches: Map<string, CellArt>[] = [new Map(), new Map(), new Map(), new Map()];
  /** Cells built per frame are limited; when the budget runs out the frame is redrawn next tick. */
  private budget = 6;
  pending = false;
  private vista: Vista;
  private frameNo = 0;
  private openW = 0;
  /** Cached DOM edges the moon must keep clear of: header bottom and the headline's text box (viewport px). */
  private skyAvoid: { header: number; text: DOMRect | null } = { header: 56, text: null };
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
    Promise.all([...CANDLE_ART, ...FLAME_ART, ...LAYERS].map(loadImage)).then((imgs) => {
      this.candleImgs = imgs.slice(0, 7);
      this.flameImgs = imgs.slice(7, 11);
      LAYERS.forEach((n, i) => {
        const key = n.slice(3, -4), im = imgs[11 + i];
        this.sheet.img[key] = im;
        if (TILES.includes(key)) this.sheet.tiles[key] = im ? pixels(im) : null;
      });
      const g = this.sheet.img["glow"];
      if (g) this.glow = upscale(g, 4);
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
    if (mobile) {
      // phones: widen the opening view just enough to keep the nearest stream's moving water in frame beside the
      // founding pedestal (never below zoom 0.42, so holders stay readable)
      const top = this.cam.y, bottom = this.cam.y + this.h / (2 * z);
      let sx = Infinity;
      for (const gx of [Math.floor(hero.x / SECTOR_W), Math.floor(hero.x / SECTOR_W) + 1])
        for (let y = Math.max(top, springY(gx) + 40); y <= bottom; y += 30) {
          const x = streamX(gx, y);
          if (x > hero.x && x - hero.x < Math.abs(sx - hero.x)) sx = x;
        }
      if (isFinite(sx)) {
        const z2 = Math.max(0.42, Math.min(z, this.w / (sx - hero.x + 220)));
        this.cam = { x: (hero.x - 90 + sx + 130) / 2, y: HORIZON_CUT + 0.16 * (this.h / z2), z: z2 };
      }
    }
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
    this.cam.z = Math.min(MAX_ZOOM, Math.max(this.minZoom(total), this.cam.z));
    const z = this.cam.z;
    const hw = this.w / 2 / z, hh = this.h / 2 / z;
    const cx0 = b.minX + hw, cx1 = b.maxX - hw;
    this.cam.x = cx0 > cx1 ? (b.minX + b.maxX) / 2 : Math.min(cx1, Math.max(cx0, this.cam.x));
    const cyMin = HORIZON_CUT + (0.05 * this.h) / z;
    const cyMax = Math.max(cyMin, b.maxY - hh);
    this.cam.y = Math.min(cyMax, Math.max(cyMin, this.cam.y));
  }

  /**
   * Pre-render one grid cell's static scenery once, as two bitmaps: the flat layer (ground cover, path, stream,
   * pools) covering exactly the cell, and the upright layer (terraces, holders, trees, bridge) with a margin
   * for overhanging sprites. A cell inside the garden (index < count) is cultivated; one outside it is the
   * same ground, stream and path as wild woodland, so the garden grows into scenery that already joins it.
   */
  private cell(index: number, wild: boolean, tier: number): CellArt | null {
    const cache = this.caches[tier];
    const key = `${index}:${wild ? 1 : 0}`;
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // LRU order
    if (this.budget <= 0) { this.pending = true; return null; }
    this.budget -= TIER_COST[tier];
    const P = BASE_PAD, M = SECTOR_MARGIN;
    // paint at the art resolution: one canvas pixel per art pixel
    const base = document.createElement("canvas");
    base.width = (SECTOR_W + 2 * P) / PX;
    base.height = (SECTOR_H + 2 * P) / PX;
    drawSectorBase(base.getContext("2d")!, index, this.sheet, wild);
    const up = document.createElement("canvas");
    up.width = (SECTOR_W + 2 * M) / PX;
    up.height = (SECTOR_H + 2 * M) / PX;
    drawSectorUpright(up.getContext("2d")!, index, this.sheet, wild);
    const art = tier === 2 ? { base, up } : { base: reduce(base, TIER_SCALE[tier] * PX), up: reduce(up, TIER_SCALE[tier] * PX) };
    if (cache.size >= TIER_KEEP[tier]) cache.delete(cache.keys().next().value!);
    cache.set(key, art);
    return art;
  }

  /** Land under every cell from the skyline down, in whole art pixels, so nothing shows through between cells. */
  private drawLand(tl: { x: number; y: number }, br: { x: number; y: number }) {
    const { ctx } = this;
    ctx.fillStyle = "#12251b";
    const step = Math.max(PX * 4, 8 / this.cam.z);
    const x0 = Math.floor((tl.x - step) / step) * step;
    for (let x = x0; x <= br.x + step; x += step) {
      const y = Math.round(horizonY(x + step / 2) / PX) * PX + PX * 2;
      ctx.fillRect(x, y, step, br.y + 50 - y);
    }
  }

  /** True when part of a stream's flowing water is on screen at a zoom the ripples are drawn at. */
  waterInView(): boolean {
    if (this.cam.z < 0.3 || this.w === 0) return false;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    const gx0 = Math.floor(tl.x / SECTOR_W) - 1, gx1 = Math.floor(br.x / SECTOR_W) + 1;
    for (let gx = gx0; gx <= gx1; gx++) {
      const y0 = Math.max(tl.y, springY(gx) + 8);
      for (let y = y0; y <= br.y; y += 40) {
        const x = streamX(gx, y), hw = streamHalf(y);
        if (x + hw >= tl.x && x - hw <= br.x) return true;
      }
    }
    return false;
  }

  /** Flowing water: bright pixel ripples drifting downstream on every stream in view (static when motion is reduced). */
  private drawWater(tl: { x: number; y: number }, br: { x: number; y: number }, time: number, still: boolean) {
    const { ctx } = this;
    if (this.cam.z < 0.3) return;
    const gx0 = Math.floor(tl.x / SECTOR_W) - 1, gx1 = Math.floor(br.x / SECTOR_W) + 1;
    const flow = still ? 0 : time * 0.02;
    for (let gx = gx0; gx <= gx1; gx++) {
      const head = springY(gx);
      const y0 = Math.max(tl.y, head + 8), y1 = br.y;
      const start = Math.floor((y0 - flow) / 14) * 14 + flow;
      for (let y = start; y < y1; y += 14) {
        if (y < head + 8) continue;
        const row = Math.round((y - flow) / 14);
        const hw = streamHalf(y) - 6;
        const off = (((row * 37) % 23) / 23 - 0.5) * 2 * hw;
        const x = Math.round((streamX(gx, y) + off) / PX) * PX, yy = Math.round(y / PX) * PX;
        ctx.fillStyle = row % 3 ? "rgba(159,240,207,0.55)" : "rgba(239,230,204,0.5)";
        ctx.fillRect(x, yy, PX * (2 + (row % 3)), PX);
      }
    }
  }

  /** Distant vista in screen space: the only parallax layer. Its foot sits on the world skyline. */
  private drawVista() {
    const { ctx, cam } = this;
    const hy = (HORIZON_CUT - cam.y) * cam.z + this.h / 2; // skyline on screen
    ctx.fillStyle = VISTA_TOP;
    ctx.fillRect(0, 0, this.w, this.h);
    if (hy < -40) return;
    const v = this.vista;
    const cw = CASTLE_W;
    ctx.imageSmoothingEnabled = false;
    // scale with zoom like a far layer, but never taller than the visible sky band, so moon and castle stay in view
    const vsMax = (Math.min(Math.max(this.h * 0.7, 320), 760) / VISTA_H) * Math.min(1.25, Math.max(0.62, 0.85 + 0.3 * Math.log2(cam.z + 0.35)));
    const vs = Math.min(vsMax, Math.max(0.3, (hy - 30) / (VISTA_H * 0.78))); // 70px of the band sits under the header
    const tw = VISTA_W * vs, th = VISTA_H * vs;
    const top = hy + 40 * vs - th;
    // parallax: the castle sits right of centre at the opening view and drifts slowly as the camera pans
    // the castle sits right of centre in the part of the screen the docked form leaves open
    if (this.frameNo++ % 30 === 0) {
      this.openW = Math.min(this.w, document.querySelector(".light-dock")?.getBoundingClientRect().left ?? this.w);
      const h1 = document.querySelector(".intro h1");
      let text: DOMRect | null = null;
      if (h1 && h1.textContent) { const r = document.createRange(); r.selectNodeContents(h1); const b = r.getBoundingClientRect(); if (b.width > 0) text = b; }
      this.skyAvoid = { header: document.querySelector(".top")?.getBoundingClientRect().bottom ?? 56, text };
    }
    const x0 = (900 - cam.x) * cam.z * 0.12 + (this.openW || this.w) * 0.7 - VISTA_CASTLE_X * tw;
    const start = (((x0 % tw) + tw) % tw) - tw;
    v.layers.forEach((layer, i) => {
      for (let x = start; x < this.w; x += tw) ctx.drawImage(layer, x, top, tw + 1, th);
      // the castle is one image, drawn once: wide screens never repeat it
      if (i === v.castleAfter) {
        const left = x0 + VISTA_CASTLE_X * tw - (cw * vs) / 2;
        const px = (cw * vs) / v.castle.width; // one castle-art pixel on screen
        this.drawMoon(left + MOON_AT.x * cw * vs, top + MOON_AT.y * th, px, CASTLE_BOXES.map((c) => ({ l: left + c.l * px, r: left + c.r * px, t: top + c.t * px })));
        ctx.drawImage(v.castle, left, top, cw * vs, th);
      }
    });
    ctx.fillStyle = VISTA_FOOT;
    ctx.fillRect(0, top + th - 1, this.w, this.h);
  }

  /**
   * The moon sits upper left of the castle in open sky. Candidate spots are tried in order and the first that clears
   * the header, the headline text, the castle silhouette and the docked panel is used: default, above the headline,
   * right of the headline, right of the castle, then a smaller moon between header and headline.
   */
  private drawMoon(x: number, y: number, px: number, castle: { l: number; r: number; t: number }[]) {
    const m = this.vista.moon, r0 = MOON_R * px;
    const { header, text } = this.skyAvoid;
    const right = this.openW || this.w;
    const hit = (b: { left: number; right: number; top: number; bottom: number }, cx: number, cy: number, r: number, gap: number) =>
      cx + r + gap > b.left && cx - r - gap < b.right && cy + r + gap > b.top && cy - r - gap < b.bottom;
    const clear = (cx: number, cy: number, r: number) =>
      cx - r >= 4 && cx + r <= right - 4 && cy - r >= header + 4 && cy + r <= this.h &&
      !(text && hit(text, cx, cy, r, 6)) && !castle.some((c) => hit({ left: c.l, right: c.r, top: c.t, bottom: this.h }, cx, cy, r, 2));
    const yc = Math.max(y, header + r0 + 6);
    const tries: [number, number, number][] = [[x, y, r0], [x, yc, r0]];
    if (text) tries.push([x, text.top - r0 - 10, r0], [text.right + r0 + 16, yc, r0]);
    const cr = Math.max(...castle.map((c) => c.r));
    tries.push([cr + r0 + 14, yc, r0]);
    if (text) { const r = Math.min(r0, (text.top - header - 14) / 2); if (r >= 9) tries.push([x, header + 5 + r, r], [Math.min(x, right - r - 8), header + 5 + r, r]); }
    const pick = tries.find(([cx, cy, r]) => clear(cx, cy, r));
    if (!pick) return; // no clear sky at this size and zoom: leave it out rather than draw it under text or chrome
    const [cx, cy, r] = pick, size = m.width * px * (r / r0);
    this.ctx.drawImage(m, Math.round(cx - size / 2), Math.round(cy - size / 2), Math.round(size), Math.round(size));
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
      g.fillRect(Math.round(pos.x - ox - 8), Math.round(pos.y - oy - 40 * pos.scale), 16, 16);
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
    this.drawLand(tl, br);
    // LOD: 0 = cached light layers per sector, 1 = sprites, 2 = sprites with animated flames
    const lod = cam.z < 0.3 ? 0 : cam.z < 0.6 ? 1 : 2;
    const tier = tierOf(cam.z);
    // magnified art stays crisp (nearest neighbour); reduced far tiers were already filtered when cached
    ctx.imageSmoothingEnabled = false;
    let drawn = 0, cells = 0;
    const P = BASE_PAD;
    const rows: { gx: number; s: number; art: CellArt | null }[][] = [];
    for (let gy = gy0; gy <= gy1; gy++) {
      const row: { gx: number; s: number; art: CellArt | null }[] = [];
      for (let gx = gx0; gx <= gx1; gx++) {
        const s = sectorAt(gx, gy);
        if (s < 0) continue;
        cells++;
        const art = this.cell(s, s >= n, tier);
        // flat layers first, everywhere: each covers only its own cell, so paths and streams join exactly
        if (art) ctx.drawImage(art.base, gx * SECTOR_W - P, gy * SECTOR_H - P, SECTOR_W + 2 * P, SECTOR_H + 2 * P);
        row.push({ gx, s, art });
      }
      rows.push(row);
    }
    this.drawWater(tl, br, time, input.reducedMotion);
    rows.forEach((row, i) => {
      const gy = gy0 + i;
      for (const { gx, art } of row) if (art) ctx.drawImage(art.up, gx * SECTOR_W - M, gy * SECTOR_H - M, SECTOR_W + 2 * M, SECTOR_H + 2 * M);
      if (gy === 0) this.drawMist(tl, br);
      // candles of this row draw before the next row's upright layer, so nearer trees and walls occlude them
      const lit = row.filter((c) => c.s < n).map((c) => c.s);
      drawn += lod === 0 ? this.drawRowLights(lit, input) : this.drawRowCandles(lit, input, tl, br, lod, time);
    });
    if (input.highlightMine || input.selected) this.drawRings(input);
    ctx.restore();
    // progressive illumination: the night lifts a little, warmly, as verified candles accumulate
    const lit = Math.min(input.candles.length, extent);
    if (lit > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(120,80,20,${(0.07 * Math.min(1, Math.log10(1 + lit) / 4)).toFixed(3)})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = "source-over";
    }
    (window as any).__gardenFrames = ((window as any).__gardenFrames ?? 0) + 1;
    this.stats = { visibleSectors: cells, drawnCandles: drawn, lod, ms: performance.now() - t0 };
    (window as any).__lastFrame = this.stats;
  }

  /** Night mist along the skyline, in world space across the whole view. */
  private drawMist(tl: { x: number; y: number }, br: { x: number; y: number }) {
    const { ctx } = this;
    const mist = ctx.createLinearGradient(0, HORIZON_CUT - 80, 0, HORIZON_CUT + 160);
    mist.addColorStop(0, "rgba(120,160,185,0)");
    mist.addColorStop(0.35, "rgba(120,160,185,0.16)");
    mist.addColorStop(1, "rgba(120,160,185,0)");
    ctx.fillStyle = mist;
    ctx.fillRect(tl.x - 10, HORIZON_CUT - 80, br.x - tl.x + 20, 240);
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
    // ignition of candles a verified receipt just created: 0 = unlit holder, 1 = established flame.
    // Reduced motion shows the completed state at once.
    const ign = lit.map(({ c }) => (input.reducedMotion ? 1 : ignition(c.id, time)));
    // warm local light, additive: fixed strength per candle so many candles brighten their own neighbourhood
    ctx.globalCompositeOperation = "lighter";
    lit.forEach(({ x, y, k, c }, i) => {
      const g = ign[i];
      const warm = g >= 1 ? 1 : smoothstep(0.2, 1, g);
      const flick = input.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(time / 260 + c.id * 1.7);
      // stepped pixel glow: halo around the flame and a warm pool (its reflection) on the ground below
      ctx.globalAlpha = 0.34 * flick * warm;
      const r = 48 * Math.max(1, k * 0.8);
      ctx.drawImage(this.glow, x - r, y - 44 * k - r, r * 2, r * 2);
      ctx.globalAlpha = 0.3 * flick * warm;
      ctx.drawImage(this.glow, x - 40 * k, y - 10 * k, 80 * k, 24 * k);
      if (g < 1 && g > 0.12) {
        // the catch: a brief bloom that swells as the wick takes and fades into the steady glow
        const b = Math.sin(Math.PI * ((g - 0.12) / 0.88));
        const br = 150 * k * (0.5 + 0.5 * g);
        ctx.globalAlpha = 0.55 * b;
        ctx.drawImage(this.glow, x - br, y - 56 * k - br, br * 2, br * 2);
      }
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    lit.forEach(({ x, y, k, c }, i) => this.drawCandle(x, y, k, c, lod === 2 && !input.reducedMotion ? time : 0, ign[i]));
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

  /**
   * One lit candle: its style sprite standing in the holder cup (HOLDER_TOP above the slot point, or on the hero
   * pedestal) and one of four flame frames, all at the garden's art resolution (1 sprite pixel = PX world units).
   * time = 0 freezes the flame on frame 0 (reduced motion or far detail level).
   */
  private drawCandle(x: number, y: number, k: number, c: Candle, time: number, ignite = 1) {
    const { ctx } = this;
    const im = this.candleImgs[c.style] ?? this.candleImgs[0];
    const cup = k > 1.5 ? 46 : HOLDER_TOP;
    const left = Math.round((x - 10) / PX) * PX, top = Math.round((y - cup + 2 - 32) / PX) * PX;
    if (im) ctx.drawImage(im, left, top, 20, 32);
    else { ctx.fillStyle = "#efe6cc"; ctx.fillRect(left + 8, top + 8, 4, 22); }
    if (ignite < 0.12) {
      // the spark at the wick before the flame takes
      ctx.fillStyle = "#fff2b0";
      if (ignite > 0.03) ctx.fillRect(left + 8, top + (WICK[c.style] ?? 1) * PX - PX, PX, PX);
      return;
    }
    const frame = time ? Math.floor(time / 140 + c.id * 1.37) & 3 : 0;
    const fl = this.flameImgs[frame];
    const grow = ignite >= 1 ? 1 : Math.min(1, (ignite - 0.12) / 0.6);
    const fh = Math.max(PX, Math.round((20 * grow) / PX) * PX);
    const wickY = top + (WICK[c.style] ?? 1) * PX;
    if (fl) ctx.drawImage(fl, 0, 10 - fh / PX, 7, fh / PX, left + 4, wickY - fh + PX, 14, fh);
    else { ctx.fillStyle = "#f5c95a"; ctx.fillRect(left + 8, wickY - fh, 4, fh); }
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

function smoothstep(a: number, b: number, v: number) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Fallback glow, in stepped pixel rings, used until the glow sprite loads. */
function makeGlow() {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  [["#9a5f1c", 48], ["#d79a32", 32], ["#f5c95a", 18]].forEach(([col, r]) => { g.fillStyle = col as string; g.beginPath(); g.arc(48, 48, r as number, 0, Math.PI * 2); g.fill(); });
  return c;
}

/** RGBA pixels of a small tile image. */
function pixels(im: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = im.width; c.height = im.height;
  const g = c.getContext("2d")!;
  g.drawImage(im, 0, 0);
  return g.getImageData(0, 0, c.width, c.height).data;
}

/** Nearest-neighbour enlargement (keeps the pixel steps of the glow when it is drawn large). */
function upscale(im: HTMLImageElement, k: number) {
  const c = document.createElement("canvas");
  c.width = im.width * k; c.height = im.height * k;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(im, 0, 0, c.width, c.height);
  return c;
}

/** Filtered reduction of a cached cell for far views. */
function reduce(src: HTMLCanvasElement, k: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
