// Purchase preview set: original vector artwork drawn in code for this project (CC0 1.0, see public/art/LICENSE.md).
// Back layer: moonlit foliage, a faint pavilion arch, a carved stone ledge with moss and jasmine, and the far rim of
// an engraved brass bowl. Front layer: the bowl's near lip and body, drawn over the candle so it sits inside the bowl.
// Decorative only (aria-hidden); it shows no candles, counts or activity.

/** Deterministic leaf sprays: [x, y, length, angle in degrees, shade 0..2]. */
const LEAVES: [number, number, number, number, number][] = [];
const FLOWERS: [number, number, number][] = [];
(function grow() {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const spray = (x0: number, y0: number, dir: 1 | -1, n: number) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = x0 + dir * (t * 70 + r() * 14), y = y0 - t * 70 + r() * 18;
      LEAVES.push([x, y, 14 + r() * 12, (dir > 0 ? -30 : 210) + (r() - 0.5) * 120, Math.floor(r() * 3)]);
      if (i % 5 === 2) FLOWERS.push([x + dir * 4, y - 3, 4 + r() * 2]);
    }
  };
  spray(-6, 186, 1, 34);
  spray(366, 186, -1, 34);
  spray(20, 120, 1, 14);
  spray(340, 118, -1, 14);
})();
const SHADES = ["#1e4a2b", "#2c6038", "#163a22"];

function Flower({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={0} cy={-r * 0.62} rx={r * 0.42} ry={r * 0.72} fill="#f3eee0" transform={`rotate(${a})`} />
      ))}
      <circle r={r * 0.28} fill="#e2bd5c" />
    </g>
  );
}

export function PreviewBack() {
  return (
    <svg className="preview-back" viewBox="0 0 360 200" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="pv-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d241b" />
          <stop offset="1" stopColor="#040a07" />
        </linearGradient>
        <radialGradient id="pv-halo" cx="180" cy="74" r="120" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffc468" stopOpacity="0.34" />
          <stop offset="0.45" stopColor="#ffa94a" stopOpacity="0.1" />
          <stop offset="1" stopColor="#ffa94a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pv-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6f6a59" />
          <stop offset="0.5" stopColor="#4a473b" />
          <stop offset="1" stopColor="#2a2922" />
        </linearGradient>
        <linearGradient id="pv-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b392f" />
          <stop offset="1" stopColor="#1b1a15" />
        </linearGradient>
        <radialGradient id="pv-pool" cx="180" cy="180" r="110" gradientTransform="matrix(1 0 0 0.18 0 147.6)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffcf7a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffcf7a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="pv-moon" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#fbf8ec" />
          <stop offset="1" stopColor="#c9c6b4" />
        </radialGradient>
      </defs>
      <rect width="360" height="200" fill="url(#pv-sky)" />
      {/* moon and its haze */}
      <circle cx="306" cy="34" r="26" fill="#dfe6da" opacity="0.08" />
      <circle cx="306" cy="34" r="11" fill="url(#pv-moon)" opacity="0.92" />
      {/* faint pavilion arch in the middle distance */}
      <g opacity="0.32" stroke="#b99a5a" fill="none" strokeWidth="1.4">
        <path d="M52 150V92M96 150V92M52 92Q74 64 96 92" />
        <path d="M46 92h56M60 86q14-16 28 0" strokeWidth="0.9" />
        <path d="M264 150V100M300 150V100M264 100Q282 76 300 100" />
      </g>
      {/* dark foliage masses behind the ledge */}
      <g fill="#0c2117">
        <ellipse cx="20" cy="120" rx="70" ry="60" />
        <ellipse cx="345" cy="118" rx="64" ry="64" />
        <ellipse cx="110" cy="160" rx="60" ry="20" />
        <ellipse cx="250" cy="160" rx="60" ry="20" />
      </g>
      <rect width="360" height="200" fill="url(#pv-halo)" />
      {/* carved stone ledge: top surface in perspective, flagstone joints, front face with a carved fillet */}
      <path d="M0 170Q180 162 360 170V188H0Z" fill="url(#pv-stone)" />
      <g stroke="#201f19" strokeWidth="1" opacity="0.75" fill="none">
        <path d="M70 168L52 188M140 166L132 188M220 166L228 188M292 168L310 188M0 179Q180 173 360 179" />
      </g>
      <g stroke="#9a937c" strokeWidth="0.7" opacity="0.3" fill="none">
        <path d="M71 169L53 189M141 167L133 189M221 167L229 189M293 169L311 189" />
      </g>
      <rect y="188" width="360" height="12" fill="url(#pv-face)" />
      <path d="M0 191.5H360" stroke="#5f5a49" strokeWidth="0.8" opacity="0.6" />
      <path d="M0 170Q180 162 360 170" stroke="#8d8670" strokeWidth="1.2" opacity="0.55" fill="none" />
      <ellipse cx="180" cy="180" rx="110" ry="20" fill="url(#pv-pool)" />
      {/* moss along the ledge edge */}
      <path d="M0 171q8-5 16 0t16 0 16-1 16 1M300 171q8-5 16 0t16 0 16-1 12 1" stroke="#33552f" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.85" />
      {/* foliage sprays and jasmine */}
      {LEAVES.map(([x, y, l, a, k], i) => (
        <path key={i} d={`M0 0Q${l * 0.5} ${-l * 0.32} ${l} 0Q${l * 0.5} ${l * 0.32} 0 0Z`} fill={SHADES[k]} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(0)})`} />
      ))}
      {FLOWERS.map(([x, y, r], i) => <Flower key={i} x={x} y={y} r={r} />)}
    </svg>
  );
}

const BRASS = (id: string) => (
  <linearGradient id={id} x1="0" x2="1">
    <stop offset="0" stopColor="#4a3410" />
    <stop offset="0.16" stopColor="#b98a3a" />
    <stop offset="0.34" stopColor="#f3d58f" />
    <stop offset="0.5" stopColor="#c99a45" />
    <stop offset="0.74" stopColor="#6e4c18" />
    <stop offset="0.9" stopColor="#d9b265" />
    <stop offset="1" stopColor="#4a3410" />
  </linearGradient>
);

/** The bowl's far rim and dark interior, behind the candle. */
export function BowlBack() {
  return (
    <svg className="preview-bowl back" viewBox="0 0 140 56" aria-hidden="true" focusable="false">
      <defs>{BRASS("pv-brass-b")}</defs>
      <ellipse cx="70" cy="12" rx="57" ry="8.4" fill="#1a1207" />
      <path d="M12 12A58 9 0 0 1 128 12" stroke="url(#pv-brass-b)" strokeWidth="3.2" fill="none" />
    </svg>
  );
}

/** The bowl's near lip, engraved body and foot, over the candle base. */
export function BowlFront() {
  return (
    <svg className="preview-bowl front" viewBox="0 0 140 56" aria-hidden="true" focusable="false">
      <defs>
        {BRASS("pv-brass-f")}
        <linearGradient id="pv-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <path d="M48 45L44 51.5H96L92 45Z" fill="url(#pv-brass-f)" />
      <ellipse cx="70" cy="52" rx="28" ry="3.4" fill="url(#pv-brass-f)" />
      <path d="M12 12C13 30 28 42 48 45H92C112 42 127 30 128 12A58 9 0 0 1 12 12Z" fill="url(#pv-brass-f)" />
      <path d="M12 12C13 30 28 42 48 45H92C112 42 127 30 128 12A58 9 0 0 1 12 12Z" fill="url(#pv-shade)" />
      {/* engraved band: two fillets and a running scroll, each cut line with a lit edge below it */}
      <g fill="none" strokeLinecap="round">
        <path d="M17 23Q70 34 123 23M22 34Q70 44 118 34" stroke="#3d2809" strokeWidth="1.1" />
        <path d="M17 24Q70 35 123 24M22 35Q70 45 118 35" stroke="#f6df9e" strokeWidth="0.6" opacity="0.5" />
        <path d="M24 29.5c4-5 8-5 10 0s6 5 10 0 8-5 10 0 6 5 10 0 8-5 10 0 6 5 10 0 8-5 10 0 6 5 10 0" stroke="#3d2809" strokeWidth="1.2" transform="translate(0 0.5)" />
        <path d="M24 30.3c4-5 8-5 10 0s6 5 10 0 8-5 10 0 6 5 10 0 8-5 10 0 6 5 10 0 8-5 10 0 6 5 10 0" stroke="#f6df9e" strokeWidth="0.5" opacity="0.45" transform="translate(0 0.5)" />
      </g>
      {/* near lip, lit from the flame above */}
      <path d="M12 12A58 9 0 0 0 128 12" stroke="url(#pv-brass-f)" strokeWidth="4" fill="none" />
      <path d="M40 18.6Q70 22.4 100 18.6" stroke="#fff3cf" strokeWidth="1.1" opacity="0.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
