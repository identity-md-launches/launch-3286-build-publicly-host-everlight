import { mulberry } from "./layout";

/**
 * The distant vista: night sky, moon, ridges of wooded hills with far terraces and a moonlit castle.
 * Procedural (original, drawn once into an offscreen canvas at start-up). It is the only screen-space
 * layer of the garden: the renderer seats its foot on the world skyline and moves it with gentle
 * parallax, so it never contains garden terrain, candles or interface.
 * The image tiles horizontally: every ridge is a sum of whole periods across VISTA_W.
 */
export const VISTA_W = 2400;
export const VISTA_H = 760;
export const VISTA_TOP = "#030807";
export const VISTA_FOOT = "#07130d";
/** Horizontal position of the castle as a fraction of VISTA_W. */
export const VISTA_CASTLE_X = 0.8;

const TAU = Math.PI * 2;

function ridge(x: number, base: number, amp: number, seed: number, harmonics: [number, number][]) {
  let y = base;
  for (const [k, a] of harmonics) y -= amp * a * Math.sin((TAU * k * x) / VISTA_W + seed * k);
  return y;
}

export function makeVista(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = VISTA_W;
  c.height = VISTA_H;
  const g = c.getContext("2d")!;
  const r = mulberry(4242);
  const W = VISTA_W, H = VISTA_H;

  // sky: emerald-black overhead, a cool teal haze toward the hills
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, VISTA_TOP);
  sky.addColorStop(0.45, "#071512");
  sky.addColorStop(0.75, "#0d2422");
  sky.addColorStop(1, "#0c1f1a");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // stars, denser and fainter toward the top
  for (let i = 0; i < 420; i++) {
    const x = r() * W, y = Math.pow(r(), 1.6) * H * 0.55;
    g.fillStyle = `rgba(230,240,230,${0.15 + r() * 0.55})`;
    g.fillRect(x, y, r() < 0.08 ? 2 : 1, r() < 0.08 ? 2 : 1);
  }

  // moon with a wide soft halo
  const mx = W * 0.62, my = 110, mr = 34;
  const halo = g.createRadialGradient(mx, my, mr, mx, my, 330);
  halo.addColorStop(0, "rgba(200,225,215,0.28)");
  halo.addColorStop(0.3, "rgba(120,160,150,0.10)");
  halo.addColorStop(1, "rgba(60,90,80,0)");
  g.fillStyle = halo;
  g.fillRect(mx - 340, 0, 680, 460);
  const disc = g.createRadialGradient(mx - 8, my - 8, 2, mx, my, mr);
  disc.addColorStop(0, "#fbf8ec");
  disc.addColorStop(0.7, "#e4e2d3");
  disc.addColorStop(1, "#bfc2b4");
  g.fillStyle = disc;
  g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
  g.fillStyle = "rgba(150,155,140,0.35)";
  for (const [dx, dy, rr] of [[-10, -6, 7], [9, 8, 5], [4, -14, 4], [-4, 12, 6]]) { g.beginPath(); g.arc(mx + dx, my + dy, rr, 0, TAU); g.fill(); }

  // moonlit cloud banks
  for (let i = 0; i < 9; i++) {
    const x = r() * W, y = 150 + r() * 160, w = 260 + r() * 360;
    const cg = g.createRadialGradient(x, y, 0, x, y, w / 2);
    const lit = Math.max(0, 1 - Math.abs(x - mx) / 900);
    cg.addColorStop(0, `rgba(${70 + 60 * lit},${95 + 60 * lit},${95 + 50 * lit},0.22)`);
    cg.addColorStop(1, "rgba(40,60,60,0)");
    g.save(); g.translate(x, y); g.scale(1, 0.18); g.translate(-x, -y);
    g.fillStyle = cg; g.beginPath(); g.arc(x, y, w / 2, 0, TAU); g.fill();
    g.restore();
  }

  const fillRidge = (f: (x: number) => number, color: string, rim: string | null) => {
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, f(x));
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    if (rim) {
      g.strokeStyle = rim; g.lineWidth = 1.5;
      g.beginPath();
      for (let x = 0; x <= W; x += 6) (x ? g.lineTo(x, f(x)) : g.moveTo(x, f(x)));
      g.stroke();
    }
  };
  const mist = (y: number, h: number, a: number) => {
    const m = g.createLinearGradient(0, y - h, 0, y + h);
    m.addColorStop(0, "rgba(110,150,150,0)");
    m.addColorStop(0.5, `rgba(110,150,150,${a})`);
    m.addColorStop(1, "rgba(110,150,150,0)");
    g.fillStyle = m;
    g.fillRect(0, y - h, W, 2 * h);
  };
  const lights = (f: (x: number) => number, n: number, depth: number, size: number) => {
    // far candle terraces: short rows of warm points following the slope
    for (let i = 0; i < n; i++) {
      const x0 = r() * W, len = 12 + r() * 40;
      const dy = 8 + r() * depth;
      for (let x = x0; x < x0 + len; x += 7 + r() * 14) {
        if (r() < 0.35) continue; // gaps: single holders, not continuous strings
        const xx = x % W, y = f(xx) + dy + Math.sin(x / 40) * 3;
        const glow = g.createRadialGradient(xx, y, 0, xx, y, size * 4);
        glow.addColorStop(0, "rgba(255,200,110,0.55)");
        glow.addColorStop(1, "rgba(255,170,70,0)");
        g.fillStyle = glow; g.fillRect(xx - size * 4, y - size * 4, size * 8, size * 8);
        g.fillStyle = "rgba(255,226,160,0.95)";
        g.fillRect(xx - size / 2, y - size / 2, size, size);
      }
    }
  };
  const treeFringe = (f: (x: number) => number, color: string, hMin: number, hMax: number, step: number) => {
    g.fillStyle = color;
    for (let x = 0; x < W; x += step * (0.6 + r() * 0.8)) {
      const y = f(x) + 3, h = hMin + r() * (hMax - hMin);
      if (r() < 0.5) { g.beginPath(); g.moveTo(x - h * 0.22, y); g.lineTo(x, y - h); g.lineTo(x + h * 0.22, y); g.fill(); }
      else { g.beginPath(); g.ellipse(x, y - h * 0.45, h * 0.42, h * 0.5, 0, 0, TAU); g.fill(); }
    }
  };

  // far mountains
  const far = (x: number) => ridge(x, 430, 70, 1.3, [[1, 0.6], [3, 0.5], [7, 0.25], [13, 0.1]]);
  fillRidge(far, "#0c1d1e", "rgba(150,190,180,0.18)");
  mist(450, 60, 0.12);

  // castle hill and castle (single, right of the moon)
  const cx = W * VISTA_CASTLE_X;
  const castleBase = far(cx) + 10;
  g.fillStyle = "#0a1718";
  const towers: [number, number, number][] = [[-120, 70, 18], [-85, 120, 22], [-40, 95, 26], [0, 170, 30], [36, 110, 24], [78, 140, 20], [118, 80, 18], [-150, 50, 14], [150, 60, 14]];
  g.fillRect(cx - 170, castleBase - 60, 340, 70);
  for (const [dx, h, w] of towers) {
    g.fillRect(cx + dx - w / 2, castleBase - 60 - h, w, h);
    g.beginPath(); g.moveTo(cx + dx - w / 2 - 4, castleBase - 60 - h); g.lineTo(cx + dx, castleBase - 60 - h - w * 1.6); g.lineTo(cx + dx + w / 2 + 4, castleBase - 60 - h); g.fill();
  }
  g.strokeStyle = "rgba(170,205,195,0.22)"; g.lineWidth = 1.2; // moon-side rim
  for (const [dx, h, w] of towers) { g.beginPath(); g.moveTo(cx + dx - w / 2, castleBase - 60); g.lineTo(cx + dx - w / 2, castleBase - 60 - h); g.lineTo(cx + dx, castleBase - 60 - h - w * 1.6); g.stroke(); }
  for (const [dx, h, w] of towers) for (let k = 0; k < h / 16; k++) {
    if (r() < 0.45) continue;
    const wx = cx + dx - w / 4 + r() * (w / 2), wy = castleBase - 70 - k * 16 - r() * 4;
    const glow = g.createRadialGradient(wx, wy, 0, wx, wy, 9);
    glow.addColorStop(0, "rgba(255,196,100,0.5)"); glow.addColorStop(1, "rgba(255,170,70,0)");
    g.fillStyle = glow; g.fillRect(wx - 9, wy - 9, 18, 18);
    g.fillStyle = "#ffd98f"; g.fillRect(wx - 1.5, wy - 2.5, 3, 5);
  }
  lights((x) => (Math.abs(x - cx) < 200 ? castleBase - 40 : far(x)), 10, 20, 2);

  // middle wooded hills with far candle terraces and aqueduct arches
  const mid = (x: number) => ridge(x, 545, 55, 4.1, [[2, 0.6], [5, 0.4], [9, 0.2], [17, 0.08]]);
  fillRidge(mid, "#0a1a15", "rgba(120,170,150,0.14)");
  treeFringe(mid, "#081511", 10, 26, 9);
  lights(mid, 45, 70, 1.8);
  g.strokeStyle = "rgba(120,140,120,0.35)"; g.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const ax = r() * W, ay = mid(ax) + 40 + r() * 30, span = 120 + r() * 100;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + span, ay); g.stroke();
    for (let x = ax + 8; x < ax + span - 8; x += 20) { g.beginPath(); g.arc(x + 10, ay + 12, 8, Math.PI, 0); g.stroke(); }
  }
  mist(600, 50, 0.1);

  // near hills: dark wooded shoulder that meets the garden's skyline
  const near = (x: number) => ridge(x, 650, 40, 7.7, [[3, 0.5], [6, 0.4], [11, 0.3], [23, 0.1]]);
  fillRidge(near, "#08160f", null);
  treeFringe(near, "#061109", 18, 46, 11);
  lights(near, 22, 50, 2.2);

  // foot: fade into the land colour so the world's skyline line sits over it
  const foot = g.createLinearGradient(0, H - 90, 0, H);
  foot.addColorStop(0, "rgba(7,19,13,0)");
  foot.addColorStop(1, VISTA_FOOT);
  g.fillStyle = foot;
  g.fillRect(0, H - 90, W, 90);
  return c;
}
