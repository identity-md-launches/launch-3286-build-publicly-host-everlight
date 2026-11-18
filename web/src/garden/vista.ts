import { mulberry } from "./layout";

/**
 * The distant vista: night sky, ridges of wooded hills with empty moonlit stone terraces, and ONE castle on its
 * own hill under the moon. Procedural (original, drawn once into offscreen canvases at start-up). It is the only
 * screen-space layer of the garden: the renderer seats its foot on the world skyline and moves it with gentle
 * parallax. The sky and ridges tile horizontally (every ridge is a sum of whole periods across VISTA_W); the
 * moon, castle hill and castle are a separate single image drawn once, so wide screens never repeat the castle.
 * No candle-like lights are painted here: lit candles come only from contract data. The castle windows are
 * steady, boxed decorative lights.
 */
export const VISTA_W = 2400;
export const VISTA_H = 760;
export const VISTA_TOP = "#030807";
export const VISTA_FOOT = "#07130d";
/** Horizontal position of the castle as a fraction of VISTA_W (centre of the castle image). */
export const VISTA_CASTLE_X = 0.8;
export const CASTLE_W = 1100;

export interface Vista {
  /** Tiled layers, back to front. */
  layers: HTMLCanvasElement[];
  /** Single castle image (moon, hill, castle), drawn once after layers[castleAfter]. */
  castle: HTMLCanvasElement;
  castleAfter: number;
}

const TAU = Math.PI * 2;

function ridge(x: number, base: number, amp: number, seed: number, harmonics: [number, number][]) {
  let y = base;
  for (const [k, a] of harmonics) y -= amp * a * Math.sin((TAU * k * x) / VISTA_W + seed * k);
  return y;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

/** A moonlit tree: cypress spire or layered round crown, shadow body with a cool rim on the moon side. */
function tree(g: CanvasRenderingContext2D, x: number, y: number, h: number, kind: number, body: string, rim: string, r: () => number) {
  if (kind === 0) {
    const w = h * 0.2;
    g.fillStyle = body;
    g.beginPath(); g.moveTo(x, y - h);
    g.bezierCurveTo(x + w, y - h * 0.7, x + w * 1.1, y - h * 0.2, x + w * 0.4, y);
    g.lineTo(x - w * 0.4, y);
    g.bezierCurveTo(x - w * 1.1, y - h * 0.2, x - w, y - h * 0.7, x, y - h); g.fill();
    g.strokeStyle = rim; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y - h); g.bezierCurveTo(x + w, y - h * 0.7, x + w * 1.1, y - h * 0.3, x + w * 0.7, y - h * 0.15); g.stroke();
  } else {
    const n = 4 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, rr = h * (0.22 + r() * 0.1);
      const cx = x + Math.cos(a) * h * 0.18, cy = y - h * 0.55 + Math.sin(a) * h * 0.16;
      g.fillStyle = body; g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.fill();
    }
    g.fillStyle = body; g.fillRect(x - h * 0.03, y - h * 0.3, h * 0.06, h * 0.3);
    g.strokeStyle = rim; g.lineWidth = 1.2;
    g.beginPath(); g.arc(x + h * 0.08, y - h * 0.62, h * 0.3, -1.9, -0.3); g.stroke();
  }
}

export function makeVista(): Vista {
  const r = mulberry(4242);
  const W = VISTA_W, H = VISTA_H;

  // ---- sky (tiled): emerald-black overhead, teal haze toward the hills, stars, thin cloud banks
  const [sky, s] = canvas(W, H);
  const grad = s.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, VISTA_TOP);
  grad.addColorStop(0.4, "#06130f");
  grad.addColorStop(0.72, "#0d2522");
  grad.addColorStop(1, "#0c1f1a");
  s.fillStyle = grad; s.fillRect(0, 0, W, H);
  for (let i = 0; i < 520; i++) {
    const x = r() * W, y = Math.pow(r(), 1.7) * H * 0.55, big = r() < 0.07;
    s.fillStyle = `rgba(230,240,230,${0.12 + r() * 0.5})`;
    s.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
  }
  for (let i = 0; i < 12; i++) {
    const x = r() * W, y = 120 + r() * 200, w = 300 + r() * 420;
    const cg = s.createRadialGradient(x, y, 0, x, y, w / 2);
    cg.addColorStop(0, "rgba(90,125,120,0.16)"); cg.addColorStop(1, "rgba(40,60,60,0)");
    s.save(); s.translate(x, y); s.scale(1, 0.16); s.translate(-x, -y);
    s.fillStyle = cg; s.beginPath(); s.arc(x, y, w / 2, 0, TAU); s.fill();
    // repeat across the seam so the tile joins
    s.beginPath(); s.arc(x - W, y, w / 2, 0, TAU); s.fill(); s.beginPath(); s.arc(x + W, y, w / 2, 0, TAU); s.fill();
    s.restore();
  }

  const fill = (g: CanvasRenderingContext2D, f: (x: number) => number, color: string | CanvasGradient, rim: string | null, w = W) => {
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, f(x));
    g.lineTo(w, H); g.closePath(); g.fillStyle = color; g.fill();
    if (rim) {
      g.strokeStyle = rim; g.lineWidth = 1.4; g.beginPath();
      for (let x = 0; x <= w; x += 4) (x ? g.lineTo(x, f(x)) : g.moveTo(x, f(x)));
      g.stroke();
    }
  };
  const mist = (g: CanvasRenderingContext2D, y: number, h: number, a: number) => {
    const m = g.createLinearGradient(0, y - h, 0, y + h);
    m.addColorStop(0, "rgba(120,160,155,0)"); m.addColorStop(0.5, `rgba(120,160,155,${a})`); m.addColorStop(1, "rgba(120,160,155,0)");
    g.fillStyle = m; g.fillRect(0, y - h, W, 2 * h);
  };
  /** Empty stone terrace ledges on a slope: pale moonlit lips and a shadowed face. Never lit. */
  const ledges = (g: CanvasRenderingContext2D, f: (x: number) => number, n: number, depth: number, scale: number) => {
    for (let i = 0; i < n; i++) {
      const x0 = r() * W, len = (40 + r() * 90) * scale, dy = 14 + r() * depth;
      g.lineWidth = Math.max(1, 2.2 * scale);
      g.strokeStyle = "rgba(10,22,18,0.9)";
      g.beginPath();
      for (let x = x0; x <= x0 + len; x += 4) { const y = f(x % W) + dy + Math.sin(x / 50) * 3 + 2 * scale; x === x0 ? g.moveTo(x % W, y) : g.lineTo(x % W, y); }
      g.stroke();
      g.strokeStyle = "rgba(150,175,160,0.32)";
      g.lineWidth = Math.max(0.8, 1.2 * scale);
      g.beginPath();
      for (let x = x0; x <= x0 + len; x += 4) { const y = f(x % W) + dy + Math.sin(x / 50) * 3; x === x0 ? g.moveTo(x % W, y) : g.lineTo(x % W, y); }
      g.stroke();
    }
  };

  // ---- far mountains (tiled)
  const [farC, fg] = canvas(W, H);
  const far = (x: number) => ridge(x, 440, 70, 1.3, [[1, 0.6], [3, 0.5], [7, 0.25], [13, 0.1]]);
  const farGrad = fg.createLinearGradient(0, 330, 0, 560);
  farGrad.addColorStop(0, "#132a29"); farGrad.addColorStop(1, "#0b1b1b");
  fill(fg, far, farGrad, "rgba(160,200,190,0.2)");
  mist(fg, 470, 70, 0.13);

  // ---- castle image (single): moon, castle hill with terraces and a falls, the castle
  const CW = CASTLE_W;
  const [castle, c] = canvas(CW, H);
  const mx = CW * 0.3, my = 250, mr = 40;
  const halo = c.createRadialGradient(mx, my, mr, mx, my, 360);
  halo.addColorStop(0, "rgba(205,228,218,0.30)"); halo.addColorStop(0.35, "rgba(120,160,150,0.10)"); halo.addColorStop(1, "rgba(60,90,80,0)");
  c.fillStyle = halo; c.fillRect(0, 0, CW, 520);
  const disc = c.createRadialGradient(mx - 12, my - 12, 3, mx, my, mr);
  disc.addColorStop(0, "#fffdf2"); disc.addColorStop(0.7, "#e8e6d6"); disc.addColorStop(1, "#c3c6b7");
  c.fillStyle = disc; c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
  c.fillStyle = "rgba(150,155,140,0.32)";
  for (const [dx, dy, rr] of [[-14, -8, 10], [12, 10, 7], [5, -19, 5], [-6, 16, 8], [20, -4, 4]]) { c.beginPath(); c.arc(mx + dx, my + dy, rr, 0, TAU); c.fill(); }

  const cx = CW * 0.58;
  const hillTop = 420;
  // hill profile: a rounded shoulder that falls away to both sides and fades into the ridges (no hard edge)
  const hill = (x: number) => {
    const d = (x - cx) / 420;
    return hillTop + 290 * (1 - Math.exp(-d * d * 2.2)) + 8 * Math.sin(x / 37) + 5 * Math.sin(x / 13);
  };
  const hg = c.createLinearGradient(0, hillTop, 0, H);
  hg.addColorStop(0, "#14302a"); hg.addColorStop(0.5, "#0d211b"); hg.addColorStop(1, "#08160f");
  c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= CW; x += 4) c.lineTo(x, Math.min(H, hill(x) + Math.max(0, Math.abs(x - cx) - 470) * 0.9));
  c.lineTo(CW, H); c.closePath(); c.fillStyle = hg; c.fill();
  // moonlight on the left (moon-side) face
  const lit = c.createLinearGradient(cx - 420, 0, cx + 100, 0);
  lit.addColorStop(0, "rgba(150,190,175,0)"); lit.addColorStop(0.6, "rgba(150,190,175,0.10)"); lit.addColorStop(1, "rgba(150,190,175,0)");
  c.fillStyle = lit; c.fill();
  // zig-zag terrace walls climbing the hill: stone lips with shadow, empty (moonlight only)
  for (let k = 0; k < 9; k++) {
    const y = hillTop + 70 + k * 30, half = 70 + k * 42, dir = k % 2 ? 1 : -1;
    c.lineWidth = 2; c.strokeStyle = "rgba(6,14,11,0.9)";
    c.beginPath(); c.moveTo(cx - half, y + 3 + dir * 6); c.quadraticCurveTo(cx, y + 3 - 10, cx + half, y + 3 - dir * 6); c.stroke();
    c.lineWidth = 1.3; c.strokeStyle = `rgba(170,190,170,${0.36 - k * 0.025})`;
    c.beginPath(); c.moveTo(cx - half, y + dir * 6); c.quadraticCurveTo(cx, y - 10, cx + half, y - dir * 6); c.stroke();
  }
  // waterfall from the castle hill: silver ribbons and a mist pool
  for (let i = 0; i < 6; i++) {
    const x = cx + 120 + i * 3;
    const wg = c.createLinearGradient(0, hillTop + 90, 0, hillTop + 300);
    wg.addColorStop(0, "rgba(190,215,210,0.0)"); wg.addColorStop(0.2, `rgba(190,215,210,${0.25 + (i % 2) * 0.15})`); wg.addColorStop(1, "rgba(150,190,185,0.05)");
    c.strokeStyle = wg; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(x, hillTop + 90); c.bezierCurveTo(x + 6, hillTop + 160, x - 4, hillTop + 230, x + 10, hillTop + 300); c.stroke();
  }
  const pool = c.createRadialGradient(cx + 132, hillTop + 300, 0, cx + 132, hillTop + 300, 60);
  pool.addColorStop(0, "rgba(170,205,200,0.28)"); pool.addColorStop(1, "rgba(170,205,200,0)");
  c.fillStyle = pool; c.fillRect(cx + 70, hillTop + 260, 130, 80);
  // trees on the hill flanks
  for (let i = 0; i < 70; i++) {
    const side = r() < 0.5 ? -1 : 1, x = cx + side * (160 + r() * 360), y = hill(x) + 10 + r() * 140;
    if (y > H - 10) continue;
    tree(c, x, y, 16 + r() * 26, r() < 0.55 ? 0 : 1, "#081711", "rgba(140,185,165,0.22)", r);
  }
  // the castle: curtain wall following the crest, keep and towers with conical roofs; stone lit by the moon
  const baseY = hillTop + 6;
  const stone = c.createLinearGradient(cx - 200, 0, cx + 200, 0);
  stone.addColorStop(0, "#3b4c49"); stone.addColorStop(0.45, "#26332f"); stone.addColorStop(1, "#151e1c");
  const towers: [number, number, number][] = [[-150, 45, 22], [-108, 80, 26], [-58, 70, 30], [0, 130, 38], [52, 94, 28], [98, 112, 24], [140, 64, 22], [176, 40, 18], [-182, 30, 18]];
  // wall: crenellated, seated into the hill with a scree fringe instead of a rectangle edge
  c.fillStyle = stone;
  c.beginPath(); c.moveTo(cx - 200, baseY + 18);
  for (let x = cx - 200; x <= cx + 200; x += 10) c.lineTo(x, baseY - 46 - ((x / 10) % 2 ? 0 : 6));
  c.lineTo(cx + 200, baseY + 18);
  for (let x = cx + 200; x >= cx - 200; x -= 8) c.lineTo(x, Math.max(baseY + 6, hill(x) - 4) + 6 * Math.sin(x));
  c.closePath(); c.fill();
  for (const [dx, h, w] of [...towers].sort((a, b) => a[1] - b[1])) {
    const x = cx + dx, top = baseY - 46 - h;
    c.fillStyle = stone; c.fillRect(x - w / 2, top, w, h + 48);
    c.fillStyle = "rgba(170,200,190,0.16)"; c.fillRect(x - w / 2, top, w * 0.32, h + 48); // moon-side face
    const roof = c.createLinearGradient(x - w, 0, x + w, 0);
    roof.addColorStop(0, "#3d5552"); roof.addColorStop(1, "#141f1e");
    c.fillStyle = roof;
    c.beginPath(); c.moveTo(x - w / 2 - 5, top); c.lineTo(x, top - w * 1.7); c.lineTo(x + w / 2 + 5, top); c.closePath(); c.fill();
    c.strokeStyle = "rgba(200,225,215,0.35)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x - w / 2 - 5, top); c.lineTo(x, top - w * 1.7); c.stroke();
    // steady decorative windows (boxed, never flames)
    for (let k = 0; k < h / 20; k++) {
      if (r() < 0.4) continue;
      const wx = x - w / 4 + r() * (w / 2), wy = top + 12 + k * 20;
      const glow = c.createRadialGradient(wx, wy, 0, wx, wy, 10);
      glow.addColorStop(0, "rgba(255,200,110,0.4)"); glow.addColorStop(1, "rgba(255,170,70,0)");
      c.fillStyle = glow; c.fillRect(wx - 10, wy - 10, 20, 20);
      c.fillStyle = "#ffd98f"; c.fillRect(wx - 1.5, wy - 3, 3, 6);
    }
  }
  // soft mist across the castle's foot so it sits in the landscape
  c.save(); c.translate(cx, baseY + 40); c.scale(1, 0.14);
  const cm = c.createRadialGradient(0, 0, 0, 0, 0, 380);
  cm.addColorStop(0, "rgba(120,160,155,0.16)"); cm.addColorStop(1, "rgba(120,160,155,0)");
  c.fillStyle = cm; c.beginPath(); c.arc(0, 0, 380, 0, TAU); c.fill(); c.restore();

  // ---- middle hills (tiled): wooded with empty stone terraces and aqueduct arches
  const [midC, mg] = canvas(W, H);
  const mid = (x: number) => ridge(x, 560, 50, 4.1, [[2, 0.6], [5, 0.4], [9, 0.2], [17, 0.08]]);
  fill(mg, mid, "#0b1d17", "rgba(130,180,160,0.16)");
  ledges(mg, mid, 34, 80, 0.9);
  for (let x = 0; x < W; x += 9 + r() * 10) tree(mg, x, mid(x) + 4 + r() * 10, 14 + r() * 22, r() < 0.5 ? 0 : 1, "#091812", "rgba(140,185,165,0.18)", r);
  mg.strokeStyle = "rgba(140,160,140,0.32)"; mg.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const ax = 200 + r() * (W - 600), ay = mid(ax) + 48 + r() * 20, span = 140 + r() * 100;
    mg.beginPath(); mg.moveTo(ax, ay); mg.lineTo(ax + span, ay); mg.stroke();
    for (let x = ax + 6; x < ax + span - 12; x += 22) { mg.beginPath(); mg.arc(x + 11, ay + 13, 9, Math.PI, 0); mg.stroke(); }
  }
  mist(mg, 615, 50, 0.1);

  // ---- near hills (tiled): dark wooded shoulder meeting the garden's skyline
  const [nearC, ng] = canvas(W, H);
  const near = (x: number) => ridge(x, 660, 36, 7.7, [[3, 0.5], [6, 0.4], [11, 0.3], [23, 0.1]]);
  fill(ng, near, "#08160f", null);
  ledges(ng, near, 16, 40, 1.3);
  for (let x = 0; x < W; x += 12 + r() * 14) tree(ng, x, near(x) + 6, 26 + r() * 36, r() < 0.45 ? 0 : 1, "#061109", "rgba(130,180,155,0.2)", r);
  const foot = ng.createLinearGradient(0, H - 90, 0, H);
  foot.addColorStop(0, "rgba(7,19,13,0)"); foot.addColorStop(1, VISTA_FOOT);
  ng.fillStyle = foot; ng.fillRect(0, H - 90, W, 90);

  return { layers: [sky, farC, midC, nearC], castle, castleAfter: 1 };
}
