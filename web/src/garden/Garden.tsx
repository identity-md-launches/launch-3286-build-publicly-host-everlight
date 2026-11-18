import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle } from "../lib/candles";
import { GardenRenderer } from "./renderer";
import { hitTest, positionOf } from "./layout";

const CAM_KEY = "everlight:v4:camera"; // v4: one world camera (garden, wild woodland and skyline)

export interface GardenHandle {
  jumpTo: (id: number) => void;
  reset: () => void;
}

interface Props {
  total: number;
  /** Onchain total (≥ total loaded): positions up to it are lit even before their page streams in. */
  known: number;
  extra?: Candle | null;
  candles: Candle[];
  selected: number | null;
  mine: Set<number>;
  highlightMine: boolean;
  reducedMotion: boolean;
  onSelect: (id: number | null) => void;
  handleRef: (h: GardenHandle) => void;
  onStats?: (s: { fps: number; ms: number; drawn: number; lod: number; missing: number }) => void;
  /** A sheet or panel covers the map: zoom, reset and minimap are hidden so they never sit over a form. */
  toolsHidden?: boolean;
  /** Screen position of the selected candle's flame, for the anchored popup (null when off screen). */
  onAnchor?: (a: { x: number; y: number } | null) => void;
}

/** The canvas garden: pan by drag or arrow keys, zoom by wheel, pinch or +/-, click a candle to read it. */
export function Garden(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const rRef = useRef<GardenRenderer | null>(null);
  const inputRef = useRef(p);
  inputRef.current = p;
  const [, setReady] = useState(0);
  const dirty = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new GardenRenderer(canvas, () => {
      dirty.current = true;
      setReady((n) => n + 1);
    });
    try {
      const saved = JSON.parse(localStorage.getItem(CAM_KEY) ?? "null");
      if (saved && [saved.x, saved.y, saved.z].every((v: unknown) => typeof v === "number" && isFinite(v as number))) r.cam = saved;
    } catch { /* default camera */ }
    const fresh = !localStorage.getItem(CAM_KEY);
    let homed = false;
    rRef.current = r;
    const ro = new ResizeObserver(() => {
      r.resize(canvas.clientWidth, canvas.clientHeight);
      if (fresh && !homed && r.w > 0) { r.home(); homed = true; }
      dirty.current = true;
    });
    ro.observe(canvas);
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    let saveAt = 0;
    let anchorKey = "";
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const inp = inputRef.current;
      const animate = !inp.reducedMotion && r.cam.z >= 0.7 && inp.candles.length > 0;
      if (!animate && !dirty.current && !r.pending) return;
      dirty.current = false;
      r.clamp(Math.max(inp.total, inp.known));
      r.draw(inp, t);
      if (inp.onAnchor) {
        let a: { x: number; y: number } | null = null;
        if (inp.selected) {
          const pos = positionOf(inp.selected - 1);
          const sp = r.toScreen(pos.x, pos.y - 56 * pos.scale);
          if (sp.x >= 0 && sp.x <= r.w && sp.y >= 0 && sp.y <= r.h) a = { x: Math.round(sp.x), y: Math.round(sp.y) };
        }
        const k = a ? `${a.x},${a.y}` : "";
        if (k !== anchorKey) { anchorKey = k; inp.onAnchor(a); }
      }
      if (miniRef.current) r.drawMinimap(miniRef.current, inp);
      frames++;
      if (t - last > 1000) {
        inp.onStats?.({ fps: Math.round((frames * 1000) / (t - last)), ms: +r.stats.ms.toFixed(2), drawn: r.stats.drawnCandles, lod: r.stats.lod, missing: r.missingAssets });
        frames = 0;
        last = t;
      }
      if (t - saveAt > 800) {
        saveAt = t;
        try { localStorage.setItem(CAM_KEY, JSON.stringify(r.cam)); } catch { /* private mode */ }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    dirty.current = true;
  }, [p.total, p.known, p.extra, p.candles, p.selected, p.mine, p.highlightMine, p.reducedMotion]);

  const jumpTo = useCallback((id: number) => {
    const r = rRef.current;
    if (!r) return;
    const pos = positionOf(id - 1);
    r.cam = { x: pos.x, y: pos.y - 40, z: Math.max(r.cam.z, 1.4) };
    dirty.current = true;
  }, []);
  const reset = useCallback(() => {
    const r = rRef.current;
    if (!r) return;
    r.home();
    dirty.current = true;
  }, []);
  useEffect(() => p.handleRef({ jumpTo, reset }), [jumpTo, reset]);

  const zoom = (f: number, sx?: number, sy?: number) => {
    const r = rRef.current!;
    const ax = sx ?? r.w / 2, ay = sy ?? r.h / 2;
    const before = r.toWorld(ax, ay);
    r.cam.z = Math.min(4, Math.max(r.minZoom(Math.max(p.total, p.known)), r.cam.z * f));
    const after = r.toWorld(ax, ay);
    r.cam.x += before.x - after.x;
    r.cam.y += before.y - after.y;
    dirty.current = true;
  };

  // pointer: drag to pan, pinch to zoom, tap to select
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const pinch = useRef(0);
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const r = rRef.current!;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) zoom(d / pinch.current);
      pinch.current = d;
      moved.current += 10;
      return;
    }
    const dx = cur.x - prev.x, dy = cur.y - prev.y;
    moved.current += Math.abs(dx) + Math.abs(dy);
    r.cam.x -= dx / r.cam.z;
    r.cam.y -= dy / r.cam.z;
    dirty.current = true;
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = 0;
    if (moved.current < 6 && pointers.current.size === 0) {
      const r = rRef.current!;
      const rect = canvasRef.current!.getBoundingClientRect();
      const w = r.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const pos = hitTest(w.x, w.y, Math.max(p.total, p.known), Math.max(26, 18 / r.cam.z));
      p.onSelect(pos !== null && (pos < p.total || p.extra?.id === pos + 1) ? pos + 1 : null);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const r = rRef.current!;
    const step = 80 / r.cam.z;
    const map: Record<string, () => void> = {
      ArrowLeft: () => (r.cam.x -= step),
      ArrowRight: () => (r.cam.x += step),
      ArrowUp: () => (r.cam.y -= step),
      ArrowDown: () => (r.cam.y += step),
      "+": () => zoom(1.25),
      "=": () => zoom(1.25),
      "-": () => zoom(0.8),
      "0": () => r.home(),
    };
    const f = map[e.key];
    if (f) {
      e.preventDefault();
      f();
      dirty.current = true;
    }
  };
  const onMini = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = rRef.current!;
    const m = miniRef.current!;
    const rect = m.getBoundingClientRect();
    const { s, ox, oy } = r.drawMinimap(m, inputRef.current);
    const mx = ((e.clientX - rect.left) / rect.width) * m.width;
    const my = ((e.clientY - rect.top) / rect.height) * m.height;
    r.cam.x = (mx - ox) / s;
    r.cam.y = (my - oy) / s;
    dirty.current = true;
  };

  return (
    <>
    <div className="garden">
      <canvas
        ref={canvasRef}
        className="garden-canvas"
        tabIndex={0}
        role="img"
        aria-label={`Garden map with ${p.total} lit candles. Arrow keys pan, plus and minus zoom, 0 resets the view. Use Find candle or the candle register to open a candle.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
        onKeyDown={onKey}
      />
      </div>
      {/* minimap and zoom sit outside the canvas wrapper so they stack above the bottom strip */}
      <div className={`map-tools${p.selected ? " has-selection" : ""}`} hidden={p.toolsHidden}>
        <canvas
          ref={miniRef}
          className="minimap"
          width={220}
          height={72}
          aria-label="Minimap: click to move the view"
          role="img"
          onPointerDown={onMini}
        />
        <div className="zoom" role="group" aria-label="Zoom">
          <button type="button" className="icon-btn" onClick={() => zoom(1.3)} aria-label="Zoom in">+</button>
          <button type="button" className="icon-btn" onClick={() => zoom(1 / 1.3)} aria-label="Zoom out">−</button>
          <button type="button" className="icon-btn" onClick={reset} aria-label="Reset view" title="Reset view">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></svg>
          </button>
        </div>
      </div>
    </>
  );
}
