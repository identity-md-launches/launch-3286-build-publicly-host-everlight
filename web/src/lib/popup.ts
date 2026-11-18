export interface Rect { left: number; top: number; right: number; bottom: number }
export interface Placement { hidden: boolean; left: number; top: number; below: boolean; overlapsAvoid: boolean }

const area = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Where the anchored candle popup goes, in viewport pixels. It sits above the flame when there is room
 * between the header and the flame, otherwise below it; it never leaves the band between the header and
 * the bottom strip, prefers the side that keeps clear of `avoid` (the headline block), and is hidden while
 * its flame is under the header or the strip, so it is never moved onto other text.
 */
export function placePopup(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  view: { w: number; top: number; bottom: number },
  avoid: Rect | null,
  gap = 8,
): Placement {
  const left = Math.min(Math.max(anchor.x, size.w / 2 + gap), view.w - size.w / 2 - gap);
  if (anchor.y < view.top + 4 || anchor.y > view.bottom - 4) return { hidden: true, left, top: 0, below: false, overlapsAvoid: false };
  const rect = (top: number): Rect => ({ left: left - size.w / 2, right: left + size.w / 2, top, bottom: top + size.h });
  const above = { top: anchor.y - 14 - size.h, below: false };
  const under = { top: anchor.y + 24, below: true };
  const fits = (c: { top: number }) => c.top >= view.top + gap && c.top + size.h <= view.bottom - gap;
  const hits = (c: { top: number }) => (avoid ? area(rect(c.top), avoid) : 0);
  const fitting = [above, under].filter(fits);
  let pick = fitting.find((c) => hits(c) === 0) ?? fitting.sort((a, b) => hits(a) - hits(b))[0];
  if (!pick) {
    // taller than either side allows: keep it inside the band on the roomier side
    const roomAbove = anchor.y - view.top, roomBelow = view.bottom - anchor.y;
    const below = roomBelow > roomAbove;
    const top = Math.max(view.top + gap, Math.min(below ? under.top : above.top, view.bottom - gap - size.h));
    pick = { top, below };
  }
  return { hidden: false, left, top: pick.top, below: pick.below, overlapsAvoid: hits(pick) > 0 };
}
