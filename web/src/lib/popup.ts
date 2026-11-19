export interface Rect { left: number; top: number; right: number; bottom: number }
/** Screen circle of the selection ring around the candle. */
export interface Ring { x: number; y: number; r: number }
export interface Placement {
  hidden: boolean;
  /** horizontal centre of the popup (it is drawn with translateX(-50%)) */
  left: number;
  top: number;
  below: boolean;
  overlapsAvoid: boolean;
  /** beside the ring instead of above or below it; the pointer moves to that edge */
  side: "left" | "right" | null;
  /** pointer offset from the popup top, for side placements */
  pointerY: number | null;
  /** scrollable height when the popup cannot be shown whole without covering the ring */
  maxH: number | null;
}

const area = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Room the pointer needs between the popup edge and the ring, on top of the 8 px clearance. */
const POINTER = 10;

/**
 * Where the anchored candle popup goes, in viewport pixels. It sits above the flame when there is room
 * between the header and the flame, otherwise below it; it never leaves the band between the header and
 * the bottom strip, prefers the side that keeps clear of `avoid` (the headline block), and is hidden while
 * its flame is under the header or the strip, so it is never moved onto other text.
 *
 * With the selection `ring` given, the popup never covers it: above and below keep `gap` px clear of the ring,
 * and when neither fits it goes beside the ring (right, then left), vertically centred on it and kept in the band.
 * If no side fits either, it takes the roomier band above or below the ring with a scrollable height.
 */
export function placePopup(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  view: { w: number; top: number; bottom: number },
  avoid: Rect | null,
  gap = 8,
  ring: Ring | null = null,
): Placement {
  const base = { side: null, pointerY: null, maxH: null } as const;
  const left = Math.min(Math.max(anchor.x, size.w / 2 + gap), view.w - size.w / 2 - gap);
  if (anchor.y < view.top + 4 || anchor.y > view.bottom - 4) return { ...base, hidden: true, left, top: 0, below: false, overlapsAvoid: false };
  const rect = (cx: number, top: number, h = size.h): Rect => ({ left: cx - size.w / 2, right: cx + size.w / 2, top, bottom: top + h });
  const hits = (r: Rect) => (avoid ? area(r, avoid) : 0);
  const ringTop = ring ? ring.y - ring.r - gap - POINTER : anchor.y - 14;
  const ringBottom = ring ? ring.y + ring.r + gap + POINTER : anchor.y + 24;
  const above = { top: Math.min(anchor.y - 14, ringTop) - size.h, below: false };
  const under = { top: Math.max(anchor.y + 24, ringBottom), below: true };
  const fits = (c: { top: number }) => c.top >= view.top + gap && c.top + size.h <= view.bottom - gap;
  const fitting = [above, under].filter(fits);
  const pick = fitting.find((c) => hits(rect(left, c.top)) === 0) ?? fitting.sort((a, b) => hits(rect(left, a.top)) - hits(rect(left, b.top)))[0];
  if (pick) return { ...base, hidden: false, left, top: pick.top, below: pick.below, overlapsAvoid: hits(rect(left, pick.top)) > 0 };

  const band = view.bottom - view.top - 2 * gap;
  if (!ring) {
    // no ring known: keep it inside the band on the roomier side
    const below = view.bottom - anchor.y > anchor.y - view.top;
    const top = Math.max(view.top + gap, Math.min(below ? under.top : above.top, view.bottom - gap - size.h));
    return { ...base, hidden: false, left, top, below, overlapsAvoid: hits(rect(left, top)) > 0 };
  }
  // beside the ring: right first, then left; the ring and the pointer stay clear
  const h = Math.min(size.h, band);
  const top = Math.max(view.top + gap, Math.min(ring.y - h / 2, view.bottom - gap - h));
  const sides = [
    { side: "right" as const, cx: ring.x + ring.r + gap + POINTER + size.w / 2 },
    { side: "left" as const, cx: ring.x - ring.r - gap - POINTER - size.w / 2 },
  ].filter((s) => s.cx - size.w / 2 >= gap && s.cx + size.w / 2 <= view.w - gap);
  const side = sides.find((s) => hits(rect(s.cx, top, h)) === 0) ?? sides[0];
  if (side) {
    const pointerY = Math.max(16, Math.min(h - 16, ring.y - top));
    return { hidden: false, left: side.cx, top, below: false, overlapsAvoid: hits(rect(side.cx, top, h)) > 0, side: side.side, pointerY, maxH: h < size.h ? h : null };
  }
  // no side fits: the roomier band above or below the ring, scrolling inside it
  const roomAbove = ringTop - (view.top + gap), roomBelow = view.bottom - gap - ringBottom;
  const below = roomBelow > roomAbove;
  const maxH = Math.max(120, Math.floor(below ? roomBelow : roomAbove));
  const t = below ? ringBottom : ringTop - Math.min(size.h, maxH);
  return { ...base, hidden: false, left, top: t, below, overlapsAvoid: hits(rect(left, t, Math.min(size.h, maxH))) > 0, maxH: Math.min(size.h, maxH) < size.h ? maxH : null };
}
