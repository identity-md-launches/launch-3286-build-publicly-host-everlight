/*
 * Everlight Garden procedural painter. Original artwork, generated deterministically in a browser
 * canvas: no third-party images, no reference pixels. Run with `node web/art-src/generate.mjs`.
 * Each export returns a canvas; the runner encodes it to WebP under web/public/art/.
 */
(() => {
  const TAU = Math.PI * 2;
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // value noise + fbm
  const PERM = (() => { const r = rng(99); const p = new Float32Array(65536); for (let i = 0; i < p.length; i++) p[i] = r(); return p; })();
  const h2 = (x, y) => PERM[((x & 255) << 8) | (y & 255)];
  const sm = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct = 5) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return s;
  }
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };

  /** Multiply a noise texture into whatever is already painted (keeps alpha). */
  function texture(g, w, h, scale, strength, seedX = 0, oct = 5, tint = null) {
    const id = g.getImageData(0, 0, w, h); const d = id.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4; if (d[i + 3] === 0) continue;
      const n = fbm(x / scale + seedX, y / scale, oct);
      const k = 1 + (n - 0.5) * 2 * strength;
      d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
      if (tint && n > tint.at) { const t = Math.min(1, (n - tint.at) * tint.k); d[i] += (tint.c[0] - d[i]) * t; d[i + 1] += (tint.c[1] - d[i + 1]) * t; d[i + 2] += (tint.c[2] - d[i + 2]) * t; }
    }
    g.putImageData(id, 0, 0);
  }
  function glow(g, x, y, r, color, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, a)); gr.addColorStop(0.35, rgba(color, a * 0.35)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }

  // ---------- organic pieces ----------
  function leaf(g, x, y, len, ang, base, light, r) {
    g.save(); g.translate(x, y); g.rotate(ang);
    const w = len * (0.32 + r() * 0.12);
    const gr = g.createLinearGradient(0, -w, 0, w);
    gr.addColorStop(0, light); gr.addColorStop(1, base);
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.3, -w, len * 0.75, -w * 0.8, len, 0);
    g.bezierCurveTo(len * 0.75, w * 0.8, len * 0.3, w, 0, 0); g.fill();
    g.strokeStyle = "rgba(160,200,150,0.18)"; g.lineWidth = Math.max(0.6, len * 0.03);
    g.beginPath(); g.moveTo(len * 0.05, 0); g.quadraticCurveTo(len * 0.5, -w * 0.12, len * 0.92, 0); g.stroke();
    g.restore();
  }
  const LEAF_DARK = ["#06140d", "#081a10", "#0a2014", "#0c2617"];
  const LEAF_MID = ["#13402a", "#175034", "#1d5a3a", "#226443", "#1a4a30"];
  /** A clump of leaves lit from the upper right by the moon. */
  function foliage(g, cx, cy, rad, n, r, opts = {}) {
    const len = opts.len ?? rad * 0.32;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * rad;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * (opts.squash ?? 0.8);
      const lit = ((x - cx) / rad) * 0.5 - ((y - cy) / rad) * 0.6 + (i / n) * 0.9;
      const base = LEAF_DARK[(r() * 4) | 0];
      const light = lit > 0.7 ? LEAF_MID[(r() * 5) | 0] : lit > 0.3 ? LEAF_DARK[3] : LEAF_DARK[1];
      leaf(g, x, y, len * (0.6 + r() * 0.6), a + (r() - 0.5) * 1.6, base, light, r);
    }
    if (opts.rim !== false) for (let i = 0; i < n * 0.12; i++) {
      const a = -0.9 + (r() - 0.5) * 1.6, d = rad * (0.75 + r() * 0.25);
      leaf(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, len * (0.6 + r() * 0.4), a + (r() - 0.5), "#123a28", "#4f8a6c", r);
    }
  }
  function flower(g, x, y, s, r, ang = 0) {
    g.save(); g.translate(x, y); g.rotate(ang);
    glow(g, 0, 0, s * 2.4, "#e8f0ff", 0.12);
    for (let p = 0; p < 5; p++) {
      g.save(); g.rotate((p / 5) * TAU + r() * 0.2);
      const gr = g.createLinearGradient(0, 0, s, 0);
      gr.addColorStop(0, "#d9d2b4"); gr.addColorStop(0.5, "#f7f4ea"); gr.addColorStop(1, "#ffffff");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(s * 0.4, -s * 0.45, s * 1.05, -s * 0.35, s * 1.05, 0); g.bezierCurveTo(s * 1.05, s * 0.35, s * 0.4, s * 0.45, 0, 0); g.fill();
      g.strokeStyle = "rgba(120,110,80,0.35)"; g.lineWidth = s * 0.04; g.beginPath(); g.moveTo(s * 0.15, 0); g.lineTo(s * 0.8, 0); g.stroke();
      g.restore();
    }
    g.fillStyle = "#d6a73c"; g.beginPath(); g.arc(0, 0, s * 0.16, 0, TAU); g.fill();
    g.fillStyle = "#f6e08c"; for (let k = 0; k < 6; k++) { const a = r() * TAU; g.fillRect(Math.cos(a) * s * 0.22, Math.sin(a) * s * 0.22, s * 0.06, s * 0.06); }
    g.restore();
  }
  function vine(g, x, y, len, ang, r, flowers = 0) {
    let px = x, py = y, a = ang;
    g.strokeStyle = "#0d2416"; g.lineWidth = 2.2; g.beginPath(); g.moveTo(px, py);
    const pts = [];
    for (let i = 0; i < len; i += 6) { a += (r() - 0.5) * 0.5; px += Math.cos(a) * 6; py += Math.sin(a) * 6; g.lineTo(px, py); pts.push([px, py, a]); }
    g.stroke();
    pts.forEach(([vx, vy, va], i) => { if (i % 2) return; leaf(g, vx, vy, 10 + r() * 10, va + (i % 4 ? 1.2 : -1.2), "#0a2014", r() < 0.35 ? "#2d6a4a" : "#164a30", r); });
    for (let k = 0; k < flowers; k++) { const p = pts[(r() * pts.length) | 0]; if (p) flower(g, p[0], p[1], 5 + r() * 4, r, r() * TAU); }
  }

  // ---------- materials ----------
  function brassGrad(g, x0, y0, x1, y1) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, "#fff0b8"); gr.addColorStop(0.18, "#e2b45a"); gr.addColorStop(0.45, "#9a6a24");
    gr.addColorStop(0.75, "#4a3010"); gr.addColorStop(1, "#21160a");
    return gr;
  }
  function stoneFill(g, x0, y0, x1, y1, warm = 0) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, warm ? "#8b8068" : "#6f7a72"); gr.addColorStop(0.5, warm ? "#4f4636" : "#3e4842"); gr.addColorStop(1, "#151a17");
    return gr;
  }

  // ---------- sprites ----------
  function frog(w = 420, h = 360, seed = 3) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rng(seed);
    const s = w / 420;
    g.scale(s, s);
    // plinth
    g.fillStyle = stoneFill(g, 60, 290, 360, 360); g.beginPath(); g.ellipse(210, 318, 165, 34, 0, 0, TAU); g.fill();
    g.fillRect(45, 318, 330, 30); g.beginPath(); g.ellipse(210, 348, 165, 12, 0, 0, TAU); g.fill();
    g.strokeStyle = "rgba(230,200,130,0.35)"; g.lineWidth = 2; g.beginPath(); g.ellipse(210, 318, 165, 34, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    // back leg haunch
    const body = () => { g.beginPath(); g.moveTo(80, 300); g.bezierCurveTo(40, 230, 90, 140, 175, 120); g.bezierCurveTo(240, 104, 300, 120, 330, 165); g.bezierCurveTo(352, 200, 345, 260, 320, 300); g.closePath(); };
    g.fillStyle = brassGrad(g, 320, 110, 120, 320); body(); g.fill();
    g.fillStyle = brassGrad(g, 140, 190, 70, 310); g.beginPath(); g.ellipse(110, 262, 72, 50, -0.35, 0, TAU); g.fill();
    // head
    g.fillStyle = brassGrad(g, 340, 110, 240, 220); g.beginPath(); g.moveTo(230, 140); g.bezierCurveTo(250, 100, 330, 96, 372, 140); g.bezierCurveTo(395, 165, 380, 200, 340, 210); g.bezierCurveTo(290, 218, 240, 200, 230, 140); g.fill();
    // mouth line
    g.strokeStyle = "rgba(30,18,6,0.8)"; g.lineWidth = 3; g.beginPath(); g.moveTo(250, 182); g.quadraticCurveTo(320, 205, 382, 165); g.stroke();
    // eyes
    for (const [ex, ey] of [[282, 112], [344, 116]]) {
      g.fillStyle = brassGrad(g, ex + 20, ey - 26, ex - 18, ey + 20); g.beginPath(); g.arc(ex, ey, 24, 0, TAU); g.fill();
      g.fillStyle = "#120c05"; g.beginPath(); g.ellipse(ex + 3, ey, 10, 6, 0, 0, TAU); g.fill();
      g.fillStyle = "#fff6d0"; g.beginPath(); g.arc(ex + 8, ey - 8, 4, 0, TAU); g.fill();
    }
    // front legs and toes
    g.fillStyle = brassGrad(g, 330, 200, 280, 320);
    g.beginPath(); g.moveTo(290, 200); g.bezierCurveTo(300, 250, 300, 280, 312, 300); g.lineTo(340, 302); g.bezierCurveTo(330, 270, 330, 240, 318, 205); g.fill();
    g.beginPath(); g.moveTo(230, 210); g.bezierCurveTo(232, 250, 236, 280, 246, 300); g.lineTo(272, 302); g.bezierCurveTo(266, 260, 264, 236, 262, 208); g.fill();
    for (const fx of [250, 318]) for (let t = 0; t < 3; t++) { g.beginPath(); g.ellipse(fx + t * 10 - 4, 303, 9, 5, 0, 0, TAU); g.fill(); }
    // back foot
    g.beginPath(); g.ellipse(150, 302, 60, 12, 0, 0, TAU); g.fill();
    // engraved warts + patina
    g.fillStyle = "rgba(40,24,8,0.45)"; for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(110 + r() * 200, 150 + r() * 120, 2 + r() * 4, 0, TAU); g.fill(); }
    g.fillStyle = "rgba(70,140,110,0.25)"; for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(90 + r() * 240, 200 + r() * 100, 3 + r() * 8, 0, TAU); g.fill(); }
    // specular highlights from candlelight (left) and moon (right)
    g.strokeStyle = "rgba(255,240,190,0.7)"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(100, 220); g.bezierCurveTo(110, 170, 150, 135, 200, 124); g.stroke();
    g.beginPath(); g.moveTo(250, 120); g.bezierCurveTo(280, 100, 330, 98, 362, 128); g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
    texture(g, w, h, 18 * s, 0.25, 4);
    return c;
  }

  function pedestal(w = 160, h = 200, seed = 5) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rng(seed);
    const cx = w / 2, top = h * 0.16, bot = h * 0.94, rw = w * 0.36;
    // shaft
    g.fillStyle = stoneFill(g, cx - rw, 0, cx + rw, 0, 1);
    const gr = g.createLinearGradient(cx - rw, 0, cx + rw, 0);
    gr.addColorStop(0, "#2a2a22"); gr.addColorStop(0.3, "#6d6450"); gr.addColorStop(0.55, "#4a4434"); gr.addColorStop(1, "#14140f");
    g.fillStyle = gr; g.fillRect(cx - rw * 0.82, top + 14, rw * 1.64, bot - top - 30);
    // base & cap rings
    const ring = (y, rx, ry, hgt) => {
      g.fillStyle = gr; g.fillRect(cx - rx, y, rx * 2, hgt);
      g.beginPath(); g.ellipse(cx, y + hgt, rx, ry, 0, 0, Math.PI); g.fill();
      g.fillStyle = "#7d735c"; g.beginPath(); g.ellipse(cx, y, rx, ry, 0, 0, TAU); g.fill();
    };
    ring(bot - 22, rw * 1.08, rw * 0.28, 18);
    ring(top + 6, rw * 1.06, rw * 0.28, 14);
    // carved band + gold inlay
    g.strokeStyle = "rgba(214,170,80,0.55)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - rw * 0.82, top + 46); g.lineTo(cx + rw * 0.82, top + 46); g.stroke();
    g.beginPath(); g.moveTo(cx - rw * 0.82, bot - 34); g.lineTo(cx + rw * 0.82, bot - 34); g.stroke();
    g.strokeStyle = "rgba(10,10,8,0.5)"; g.lineWidth = 1.5;
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(cx + k * rw * 0.3, top + 52); g.lineTo(cx + k * rw * 0.3, bot - 40); g.stroke(); }
    // empty cup on top
    g.fillStyle = "#1a1813"; g.beginPath(); g.ellipse(cx, top + 6, rw * 0.78, rw * 0.18, 0, 0, TAU); g.fill();
    g.strokeStyle = "rgba(240,210,140,0.5)"; g.lineWidth = 2; g.beginPath(); g.ellipse(cx, top + 6, rw * 0.92, rw * 0.24, 0, 0, TAU); g.stroke();
    texture(g, w, h, 10, 0.35, 7, 4, { at: 0.62, k: 4, c: [40, 86, 56] });
    // moss and a few leaves at the base
    for (let i = 0; i < 14; i++) leaf(g, cx - rw + r() * rw * 2, bot - 4 - r() * 10, 10 + r() * 10, -Math.PI / 2 + (r() - 0.5) * 2.2, "#0a2014", "#1d5a3a", r);
    return c;
  }

  function tree(w, h, seed, kind = 0) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rng(seed);
    const cx = w / 2;
    g.strokeStyle = "#1c140c"; g.lineCap = "round";
    const branch = (x, y, a, len, wd, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.lineWidth = wd; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.3) * len * 0.5, y + Math.sin(a + 0.3) * len * 0.5, x2, y2); g.stroke();
      if (depth > 0) { branch(x2, y2, a - 0.45 - r() * 0.3, len * 0.72, wd * 0.62, depth - 1); branch(x2, y2, a + 0.45 + r() * 0.3, len * 0.72, wd * 0.62, depth - 1); }
    };
    branch(cx, h, -Math.PI / 2, h * 0.3, w * 0.07, 3);
    if (kind === 1) { // cypress
      for (let i = 0; i < 9; i++) foliage(g, cx, h * (0.15 + i * 0.08), w * 0.22 * (0.6 + i * 0.06), 60, r, { len: w * 0.08, squash: 1 });
    } else {
      const clumps = 7 + ((r() * 4) | 0);
      for (let i = 0; i < clumps; i++) {
        const a = -Math.PI / 2 + (r() - 0.5) * 2.4, d = r() * w * 0.28;
        foliage(g, cx + Math.cos(a) * d, h * 0.38 + Math.sin(a) * d * 0.7, w * (0.16 + r() * 0.1), 90, r, { len: w * 0.07 });
      }
    }
    texture(g, w, h, 14, 0.25, seed);
    return c;
  }

  function bridge(w = 640, h = 260, seed = 8) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rng(seed);
    const deck = h * 0.32, arches = 3;
    g.fillStyle = stoneFill(g, 0, 0, 0, h, 1);
    g.beginPath(); g.moveTo(0, deck + 20); g.quadraticCurveTo(w / 2, deck - 40, w, deck + 20); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
    // arch openings
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < arches; i++) {
      const ax = (w / arches) * (i + 0.5), aw = w / arches * 0.36;
      g.beginPath(); g.moveTo(ax - aw, h); g.lineTo(ax - aw, deck + 60 + Math.abs(i - 1) * 14); g.arc(ax, deck + 60 + Math.abs(i - 1) * 14, aw, Math.PI, 0); g.lineTo(ax + aw, h); g.fill();
    }
    g.globalCompositeOperation = "source-over";
    // voussoirs
    g.strokeStyle = "rgba(20,16,10,0.6)"; g.lineWidth = 2;
    for (let i = 0; i < arches; i++) {
      const ax = (w / arches) * (i + 0.5), aw = w / arches * 0.36, ay = deck + 60 + Math.abs(i - 1) * 14;
      for (let k = 0; k <= 10; k++) { const a = Math.PI + (k / 10) * Math.PI; g.beginPath(); g.moveTo(ax + Math.cos(a) * aw, ay + Math.sin(a) * aw); g.lineTo(ax + Math.cos(a) * (aw + 18), ay + Math.sin(a) * (aw + 18)); g.stroke(); }
      g.strokeStyle = "rgba(230,200,140,0.35)"; g.beginPath(); g.arc(ax, ay, aw + 18, Math.PI * 1.1, Math.PI * 1.6); g.stroke(); g.strokeStyle = "rgba(20,16,10,0.6)";
    }
    // brick courses
    for (let y = deck + 30; y < h; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.globalAlpha = 0.25; g.stroke(); g.globalAlpha = 1; }
    // parapet with balusters
    g.fillStyle = "#5d5543"; g.beginPath(); g.moveTo(0, deck + 4); g.quadraticCurveTo(w / 2, deck - 56, w, deck + 4); g.lineTo(w, deck + 14); g.quadraticCurveTo(w / 2, deck - 46, 0, deck + 14); g.fill();
    for (let x = 8; x < w; x += 18) { const y = deck + 14 - (1 - Math.pow((x - w / 2) / (w / 2), 2)) * 30; g.fillStyle = "#3e382c"; g.fillRect(x, y, 7, 18); }
    g.fillStyle = "#6d6450"; g.beginPath(); g.moveTo(0, deck + 22); g.quadraticCurveTo(w / 2, deck - 38, w, deck + 22); g.lineTo(w, deck + 30); g.quadraticCurveTo(w / 2, deck - 30, 0, deck + 30); g.fill();
    texture(g, w, h, 12, 0.4, 3, 4, { at: 0.64, k: 3, c: [30, 70, 44] });
    // ivy
    for (let i = 0; i < 6; i++) vine(g, r() * w, deck + 10, 40 + r() * 70, Math.PI / 2 + (r() - 0.5), r, 0);
    return c;
  }

  function gazebo(w = 300, h = 360, seed = 11) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rng(seed);
    const cx = w / 2, base = h * 0.9, top = h * 0.38;
    glow(g, cx, base - 70, 120, "#ffbe6a", 0.35);
    // steps
    g.fillStyle = stoneFill(g, 0, base - 20, 0, h, 1);
    for (let k = 0; k < 3; k++) { g.beginPath(); g.ellipse(cx, base + k * 9, w * 0.42 + k * 10, 16, 0, 0, TAU); g.fill(); }
    // inner warm light
    const inner = g.createLinearGradient(0, top, 0, base);
    inner.addColorStop(0, "#5a3a14"); inner.addColorStop(1, "#c88a3a");
    g.fillStyle = inner; g.fillRect(cx - w * 0.3, top + 30, w * 0.6, base - top - 30);
    // columns
    for (let k = -3; k <= 3; k++) {
      const x = cx + k * w * 0.1, cw = 12 - Math.abs(k) * 1.2;
      const gr = g.createLinearGradient(x - cw, 0, x + cw, 0); gr.addColorStop(0, "#3a3226"); gr.addColorStop(0.4, "#d6c79c"); gr.addColorStop(1, "#3a3226");
      g.fillStyle = gr; g.fillRect(x - cw / 2, top + 28, cw, base - top - 34);
    }
    // entablature + dome
    g.fillStyle = "#7a6c4e"; g.fillRect(cx - w * 0.36, top + 14, w * 0.72, 18);
    g.strokeStyle = "#e0b75e"; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - w * 0.36, top + 16); g.lineTo(cx + w * 0.36, top + 16); g.stroke();
    const dg = g.createLinearGradient(cx - w * 0.3, top - 90, cx + w * 0.3, top + 10);
    dg.addColorStop(0, "#2a5a46"); dg.addColorStop(0.4, "#163a2c"); dg.addColorStop(1, "#0b1d16");
    g.fillStyle = dg; g.beginPath(); g.ellipse(cx, top + 14, w * 0.33, w * 0.32, 0, Math.PI, 0); g.fill();
    g.strokeStyle = "#c9a04f"; g.lineWidth = 1.5;
    for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(cx + k * w * 0.095, top + 14); g.quadraticCurveTo(cx + k * w * 0.05, top - w * 0.22, cx, top + 14 - w * 0.32); g.stroke(); }
    g.fillStyle = "#e7c06a"; g.beginPath(); g.moveTo(cx, top - w * 0.42); g.lineTo(cx - 5, top + 14 - w * 0.32); g.lineTo(cx + 5, top + 14 - w * 0.32); g.fill();
    g.beginPath(); g.arc(cx, top - w * 0.42, 5, 0, TAU); g.fill();
    texture(g, w, h, 9, 0.25, 11);
    for (let i = 0; i < 5; i++) foliage(g, cx + (r() < 0.5 ? -1 : 1) * w * (0.32 + r() * 0.12), base - r() * 40, 30 + r() * 20, 50, r, { len: 12 });
    return c;
  }

  function waterfall(w = 120, h = 220, seed = 13) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rng(seed);
    for (let i = 0; i < 140; i++) {
      const x = w * 0.15 + r() * w * 0.7, y0 = r() * h * 0.2, len = h * (0.5 + r() * 0.5);
      g.strokeStyle = `rgba(${200 + r() * 55},${225 + r() * 30},255,${0.08 + r() * 0.22})`; g.lineWidth = 1 + r() * 3;
      g.beginPath(); g.moveTo(x, y0); g.bezierCurveTo(x, y0 + len * 0.3, x + (r() - 0.5) * 6, y0 + len * 0.7, x + (r() - 0.5) * 10, y0 + len); g.stroke();
    }
    const mist = g.createRadialGradient(w / 2, h * 0.92, 2, w / 2, h * 0.92, w * 0.6);
    mist.addColorStop(0, "rgba(220,240,255,0.5)"); mist.addColorStop(1, "rgba(220,240,255,0)");
    g.fillStyle = mist; g.fillRect(0, 0, w, h);
    return c;
  }

  function bush(w = 260, h = 170, seed = 17, flowers = 6) {
    const c = canvas(w, h), g = c.getContext("2d"), r = rng(seed);
    foliage(g, w * 0.5, h * 0.62, w * 0.42, 260, r, { len: w * 0.09, squash: 0.6 });
    for (let i = 0; i < flowers; i++) flower(g, w * 0.15 + r() * w * 0.7, h * 0.35 + r() * h * 0.45, 7 + r() * 6, r, r() * TAU);
    return c;
  }

  function lantern(w = 60, h = 150) {
    const c = canvas(w, h), g = c.getContext("2d");
    glow(g, w / 2, 36, 30, "#ffd28a", 0.6);
    g.fillStyle = "#2a1e10"; g.fillRect(w / 2 - 3, 50, 6, h - 50);
    g.fillStyle = brassGrad(g, w / 2 + 14, 20, w / 2 - 14, 60);
    g.beginPath(); g.moveTo(w / 2 - 14, 22); g.lineTo(w / 2 + 14, 22); g.lineTo(w / 2, 8); g.fill();
    g.fillRect(w / 2 - 12, 48, 24, 5);
    g.fillStyle = "#ffdf9e"; g.fillRect(w / 2 - 9, 24, 18, 24);
    g.strokeStyle = "#3a2810"; g.lineWidth = 2; g.strokeRect(w / 2 - 9, 24, 18, 24); g.beginPath(); g.moveTo(w / 2, 24); g.lineTo(w / 2, 48); g.stroke();
    return c;
  }

  // ---------- backdrop: sky, moon, mountains, castle, distant terraces ----------
  function backdrop(W = 2400, H = 1000) {
    const c = canvas(W, H), g = c.getContext("2d"), r = rng(21);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#03080d"); sky.addColorStop(0.35, "#0a1a26"); sky.addColorStop(0.62, "#10283a"); sky.addColorStop(1, "#071510");
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) { const y = Math.pow(r(), 1.6) * H * 0.6; g.fillStyle = `rgba(220,232,255,${0.15 + r() * 0.6})`; const s = r() < 0.04 ? 2.2 : 1.1; g.fillRect(r() * W, y, s, s); }
    // moon
    const mx = W * 0.72, my = H * 0.13, mr = 46;
    glow(g, mx, my, 360, "#9fc4e8", 0.22); glow(g, mx, my, 120, "#e8f2ff", 0.4);
    const mg = g.createRadialGradient(mx - 14, my - 14, 4, mx, my, mr);
    mg.addColorStop(0, "#fffef6"); mg.addColorStop(0.7, "#e4e8e2"); mg.addColorStop(1, "#b9c2c4");
    g.fillStyle = mg; g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fill();
    g.fillStyle = "rgba(120,130,140,0.28)"; for (let i = 0; i < 12; i++) { const a = r() * TAU, d = r() * mr * 0.75; g.beginPath(); g.arc(mx + Math.cos(a) * d, my + Math.sin(a) * d, 3 + r() * 9, 0, TAU); g.fill(); }
    // clouds: fbm wisps, moonlit edges
    const cl = g.getImageData(0, 0, W, H * 0.5 | 0), d = cl.data, cw = W;
    for (let y = 0; y < (H * 0.5 | 0); y++) for (let x = 0; x < W; x++) {
      const n = fbm(x / 260, y / 70, 5); const t = Math.max(0, n - 0.52) * 2.2 * (1 - y / (H * 0.5));
      if (t <= 0) continue; const i = (y * cw + x) * 4; const near = Math.max(0, 1 - Math.hypot(x - mx, y - my) / 520);
      d[i] += (40 + near * 120 - d[i]) * t; d[i + 1] += (58 + near * 130 - d[i + 1]) * t; d[i + 2] += (76 + near * 140 - d[i + 2]) * t;
    }
    g.putImageData(cl, 0, 0);
    // mountain ranges
    const ridge = (base, amp, sc, col, seed) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, base - fbm(x / sc + seed, seed, 5) * amp);
      g.lineTo(W, H); g.fill();
    };
    ridge(H * 0.48, 260, 420, "#132636", 1);
    const mist1 = g.createLinearGradient(0, H * 0.3, 0, H * 0.55); mist1.addColorStop(0, "rgba(90,130,160,0)"); mist1.addColorStop(1, "rgba(90,130,160,0.22)");
    g.fillStyle = mist1; g.fillRect(0, H * 0.3, W, H * 0.25);
    ridge(H * 0.56, 200, 300, "#0e1f22", 7);
    // castle hill (upper right) with castle
    g.fillStyle = "#0d1c1a"; g.beginPath(); g.moveTo(W * 0.62, H * 0.6); g.bezierCurveTo(W * 0.7, H * 0.36, W * 0.76, H * 0.26, W * 0.84, H * 0.25); g.bezierCurveTo(W * 0.92, H * 0.26, W * 0.97, H * 0.4, W, H * 0.46); g.lineTo(W, H * 0.6); g.fill();
    castle(g, W * 0.84, H * 0.27, 1.25, r);
    // second smaller castle/temple on the left hills
    castle(g, W * 0.36, H * 0.43, 0.55, r);
    // distant terraced hills with tree clusters and warm windows
    for (let band = 0; band < 5; band++) {
      const y0 = H * (0.5 + band * 0.1), col = ["#0b1d18", "#0a1c15", "#091a13", "#08170f", "#06130c"][band];
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, y0 - fbm(x / (220 - band * 20) + band * 9, band, 4) * (90 - band * 8));
      g.lineTo(W, H); g.fill();
      const tr = rng(100 + band);
      for (let i = 0; i < 70 + band * 30; i++) {
        const x = tr() * W, yy = y0 - fbm(x / (220 - band * 20) + band * 9, band, 4) * (90 - band * 8);
        const s = 5 + band * 3 + tr() * 6;
        g.fillStyle = band < 2 ? "#0f2a22" : LEAF_DARK[(tr() * 4) | 0]; g.beginPath(); g.ellipse(x, yy - s * 0.6, s, s * (tr() < 0.2 ? 2.2 : 1), 0, 0, TAU); g.fill();
        g.fillStyle = "rgba(120,170,150,0.12)"; g.beginPath(); g.ellipse(x + s * 0.3, yy - s, s * 0.5, s * 0.5, 0, 0, TAU); g.fill();
      }
      // terrace walls as faint stepped lines
      g.strokeStyle = `rgba(150,170,150,${0.05 + band * 0.015})`; g.lineWidth = 1;
      for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = 0; x <= W; x += 10) { const y = y0 + 14 + k * 18 - fbm(x / 300 + k, band + 3, 3) * 40; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
      // mist between bands
      const m = g.createLinearGradient(0, y0 - 60, 0, y0 + 20); m.addColorStop(0, "rgba(110,150,170,0)"); m.addColorStop(1, `rgba(110,150,170,${0.1 - band * 0.015})`);
      g.fillStyle = m; g.fillRect(0, y0 - 60, W, 80);
    }
    // a silver river catching the moon in the distance
    g.strokeStyle = "rgba(150,190,215,0.35)"; g.lineWidth = 3; g.beginPath();
    for (let k = 0; k <= 40; k++) { const t = k / 40; const x = W * (0.7 - t * 0.25) + Math.sin(t * 9) * 60; const y = H * (0.42 + t * 0.5); k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    texture(g, W, H, 40, 0.12, 2, 3);
    return c;
  }
  function castle(g, cx, base, s, r) {
    g.save(); g.translate(cx, base); g.scale(s, s);
    const stone = "#1a2b33", lit = "#2a4150";
    const tower = (x, w, h, roof) => {
      const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0); gr.addColorStop(0, "#0f1b20"); gr.addColorStop(0.7, lit); gr.addColorStop(1, stone);
      g.fillStyle = gr; g.fillRect(x - w / 2, -h, w, h);
      g.fillStyle = "#0c161b"; g.beginPath(); g.moveTo(x - w / 2 - 4, -h); g.lineTo(x, -h - roof); g.lineTo(x + w / 2 + 4, -h); g.fill();
      g.strokeStyle = "rgba(160,200,230,0.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, -h - roof); g.lineTo(x + w / 2 + 4, -h); g.stroke();
      for (let k = 0; k < h / 26 - 1; k++) if (r() < 0.75) { g.fillStyle = r() < 0.5 ? "#ffcf7a" : "#f3b45a"; g.fillRect(x - 2.5 + (r() - 0.5) * w * 0.4, -h + 14 + k * 26, 5, 8); }
    };
    g.fillStyle = stone; g.fillRect(-170, -70, 340, 70);
    for (let x = -170; x < 170; x += 12) g.fillRect(x, -78, 7, 8);
    for (let k = 0; k < 14; k++) if (r() < 0.8) { g.fillStyle = "#ffc86a"; g.fillRect(-160 + k * 24, -46, 5, 8); }
    [[-150, 30, 120, 40], [-95, 26, 170, 50], [-40, 40, 230, 70], [20, 34, 290, 90], [80, 30, 200, 60], [135, 28, 150, 46], [-10, 18, 330, 60]].forEach(([x, w, h, rf]) => tower(x, w, h, rf));
    glow(g, 0, -120, 260, "#ffb75a", 0.12);
    g.restore();
  }

  // ---------- foreground frames ----------
  function frameLeft(W = 760, H = 1100) {
    const c = canvas(W, H), g = c.getContext("2d"), r = rng(31);
    // back foliage mass
    foliage(g, 120, 200, 260, 700, r, { len: 46 });
    foliage(g, 60, 620, 240, 600, r, { len: 44 });
    // two carved columns with an arch
    const col = (x, w, top) => {
      const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      gr.addColorStop(0, "#1a1a14"); gr.addColorStop(0.3, "#8a7f63"); gr.addColorStop(0.55, "#5b5341"); gr.addColorStop(1, "#16150f");
      g.fillStyle = gr; g.fillRect(x - w / 2, top, w, H - top);
      g.strokeStyle = "rgba(12,10,6,0.55)"; g.lineWidth = 2; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + k * w * 0.17, top + 50); g.lineTo(x + k * w * 0.17, H); g.stroke(); }
      g.fillStyle = gr; g.fillRect(x - w * 0.7, top, w * 1.4, 34); g.fillRect(x - w * 0.62, top + 34, w * 1.24, 16);
      g.strokeStyle = "rgba(225,190,110,0.55)"; g.beginPath(); g.moveTo(x - w * 0.7, top + 34); g.lineTo(x + w * 0.7, top + 34); g.stroke();
      // volutes
      g.strokeStyle = "rgba(20,16,10,0.7)"; g.lineWidth = 3; for (const sx of [-1, 1]) { g.beginPath(); g.arc(x + sx * w * 0.52, top + 18, 11, 0, TAU * 0.8); g.stroke(); }
    };
    col(70, 92, 250); col(300, 80, 300);
    // arch springing between the columns
    g.lineWidth = 46; g.strokeStyle = stoneFill(g, 0, 120, 0, 300, 1);
    g.beginPath(); g.arc(185, 300, 130, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
    g.lineWidth = 2; g.strokeStyle = "rgba(225,190,110,0.5)"; g.beginPath(); g.arc(185, 300, 152, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.strokeStyle = "rgba(12,10,6,0.6)"; for (let k = 0; k <= 12; k++) { const a = Math.PI + (k / 12) * Math.PI; g.beginPath(); g.moveTo(185 + Math.cos(a) * 108, 300 + Math.sin(a) * 108); g.lineTo(185 + Math.cos(a) * 152, 300 + Math.sin(a) * 152); g.stroke(); }
    // emerald banner with gold emblem
    g.fillStyle = "#0d3b2a"; g.beginPath(); g.moveTo(150, 230); g.lineTo(222, 230); g.lineTo(222, 440); g.lineTo(186, 476); g.lineTo(150, 440); g.fill();
    g.strokeStyle = "#d6a94e"; g.lineWidth = 3; g.stroke();
    g.strokeStyle = "#e6bd63"; g.lineWidth = 2.5; g.beginPath(); g.moveTo(186, 420); g.lineTo(186, 300); g.stroke();
    for (let k = 0; k < 5; k++) { leaf(g, 186, 400 - k * 22, 22 - k * 2, -2.3, "#a37a2c", "#f3d27e", r); leaf(g, 186, 400 - k * 22, 22 - k * 2, -0.84, "#a37a2c", "#f3d27e", r); }
    texture(g, W, H, 14, 0.3, 31, 4, { at: 0.63, k: 3, c: [24, 70, 44] });
    // ivy over columns and arch
    for (let i = 0; i < 16; i++) vine(g, 20 + r() * 330, 120 + r() * 200, 120 + r() * 260, Math.PI / 2 + (r() - 0.5) * 0.8, r, 2);
    // armillary sphere on a short pedestal
    g.save(); g.translate(180, 760);
    g.fillStyle = stoneFill(g, -40, 0, 40, 0, 1); g.fillRect(-36, 20, 72, 160); g.fillRect(-48, 10, 96, 18); g.fillRect(-50, 172, 100, 20);
    g.strokeStyle = "#d9ad55"; g.lineWidth = 4; g.beginPath(); g.arc(0, -44, 54, 0, TAU); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.ellipse(0, -44, 54, 18, 0.4, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(0, -44, 20, 54, 0.3, 0, TAU); g.stroke();
    g.strokeStyle = "#8a6526"; g.lineWidth = 6; g.beginPath(); g.moveTo(0, 10); g.lineTo(0, -10); g.stroke();
    g.restore();
    // brass frog on a mossy rock
    const f = frog(360, 308, 41);
    g.fillStyle = "#151812"; g.beginPath(); g.ellipse(360, 1010, 210, 70, 0, 0, TAU); g.fill();
    g.drawImage(f, 200, 720);
    // dense foreground leaves and white flowers
    foliage(g, 150, 1010, 300, 900, r, { len: 60, squash: 0.5 });
    foliage(g, 520, 1070, 220, 400, r, { len: 52, squash: 0.4 });
    for (let i = 0; i < 18; i++) flower(g, 20 + r() * 520, 860 + r() * 220, 14 + r() * 14, r, r() * TAU);
    for (let i = 0; i < 8; i++) flower(g, 10 + r() * 140, 380 + r() * 420, 12 + r() * 10, r, r() * TAU);
    return c;
  }
  function frameRight(W = 560, H = 760) {
    const c = canvas(W, H), g = c.getContext("2d"), r = rng(51);
    g.fillStyle = "#121611"; g.beginPath(); g.moveTo(80, H); g.bezierCurveTo(90, 520, 220, 430, 380, 440); g.bezierCurveTo(500, 450, 560, 520, W, 560); g.lineTo(W, H); g.fill();
    g.fillStyle = stoneFill(g, 100, 420, 400, 760, 0); g.beginPath(); g.moveTo(140, H); g.bezierCurveTo(150, 560, 250, 480, 380, 480); g.bezierCurveTo(470, 485, 520, 540, W, 580); g.lineTo(W, H); g.fill();
    texture(g, W, H, 16, 0.45, 51, 5, { at: 0.6, k: 3, c: [30, 70, 44] });
    const f = frog(300, 257, 52);
    g.save(); g.translate(470, 260); g.scale(-1, 1); g.drawImage(f, 0, 0); g.restore();
    foliage(g, 480, 160, 130, 260, r, { len: 38 });
    foliage(g, 330, 720, 260, 600, r, { len: 52, squash: 0.45 });
    for (let i = 0; i < 9; i++) flower(g, 180 + r() * 360, 600 + r() * 150, 12 + r() * 10, r, r() * TAU);
    return c;
  }
  function canopy(W = 2400, H = 360) {
    const c = canvas(W, H), g = c.getContext("2d"), r = rng(61);
    for (let i = 0; i < 26; i++) {
      const x = Math.pow(r(), 1.7) * W * 0.62, y = r() * H * 0.35;
      foliage(g, x, y, 80 + r() * 90 * (1 - x / W), 160, r, { len: 34, squash: 0.6 });
    }
    for (let i = 0; i < 8; i++) foliage(g, W - r() * 260, r() * H * 0.25, 60 + r() * 60, 120, r, { len: 30, squash: 0.6 });
    for (let i = 0; i < 14; i++) vine(g, r() * W * 0.55, 30 + r() * 80, 80 + r() * 160, Math.PI / 2 + (r() - 0.5) * 0.6, r, 0);
    return c;
  }
  /** Seamless dark ground texture tile used to fill terraces. */
  function groundTile(S = 512) {
    const c = canvas(S, S), g = c.getContext("2d"), id = g.createImageData(S, S), d = id.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      // periodic fbm by blending
      const fx = x / S, fy = y / S;
      const n = (fbm(x / 40, y / 40) * (1 - fx) * (1 - fy) + fbm((x - S) / 40, y / 40) * fx * (1 - fy) + fbm(x / 40, (y - S) / 40) * (1 - fx) * fy + fbm((x - S) / 40, (y - S) / 40) * fx * fy);
      const m = fbm(x / 9 + 50, y / 9);
      const i = (y * S + x) * 4;
      d[i] = 10 + n * 22 + m * 8; d[i + 1] = 26 + n * 40 + m * 10; d[i + 2] = 18 + n * 24 + m * 6; d[i + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c;
  }
  function stoneTile(S = 256) {
    const c = canvas(S, S), g = c.getContext("2d"), r = rng(71);
    g.fillStyle = "#3d3a30"; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 32) for (let x = -((y / 32) % 2) * 24; x < S; x += 48) {
      const v = 45 + r() * 40; g.fillStyle = `rgb(${v + 20},${v + 16},${v})`;
      g.beginPath(); g.roundRect(x + 2, y + 2, 44, 28, 5); g.fill();
    }
    texture(g, S, S, 10, 0.35, 71, 4, { at: 0.64, k: 3, c: [28, 64, 40] });
    return c;
  }

  window.EVERLIGHT_ART = {
    "backdrop": () => backdrop(),
    "frame-left": () => frameLeft(),
    "frame-right": () => frameRight(),
    "canopy": () => canopy(),
    "frog": () => frog(420, 360, 3),
    "pedestal": () => pedestal(),
    "tree-0": () => tree(260, 320, 81, 0),
    "tree-1": () => tree(300, 340, 82, 0),
    "tree-2": () => tree(120, 340, 83, 1),
    "bridge": () => bridge(),
    "gazebo": () => gazebo(),
    "waterfall": () => waterfall(),
    "bush": () => bush(),
    "bush-plain": () => bush(240, 150, 18, 0),
    "lantern": () => lantern(),
    "ground": () => groundTile(),
    "stone": () => stoneTile(),
  };
})();
