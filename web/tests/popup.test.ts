import { describe, expect, it } from "vitest";
import { placePopup } from "../src/lib/popup";

const view = { w: 1440, top: 56, bottom: 824 };
const size = { w: 320, h: 408 };
const intro = { left: 72, top: 60, right: 610, bottom: 235 };

describe("anchored popup placement", () => {
  it("sits above the flame when there is room", () => {
    const p = placePopup({ x: 900, y: 700 }, size, view, intro);
    expect(p).toMatchObject({ hidden: false, below: false, top: 700 - 14 - 408 });
  });
  it("flips below the flame instead of sliding under the header", () => {
    const p = placePopup({ x: 520, y: 260 }, size, view, intro);
    expect(p.below).toBe(true);
    expect(p.top).toBeGreaterThanOrEqual(view.top + 8);
    expect(p.top + size.h).toBeLessThanOrEqual(view.bottom - 8);
  });
  it("prefers the side that keeps clear of the headline", () => {
    // above would cover the headline, below fits: it goes below
    const p = placePopup({ x: 520, y: 300 }, { w: 320, h: 200 }, view, intro);
    expect(p).toMatchObject({ below: true, overlapsAvoid: false, top: 324 });
  });
  it("is hidden while the flame is under the header or the strip", () => {
    expect(placePopup({ x: 500, y: 30 }, size, view, intro).hidden).toBe(true);
    expect(placePopup({ x: 500, y: 850 }, size, view, intro).hidden).toBe(true);
  });
  it("never leaves the band between header and strip", () => {
    for (let y = 70; y < 820; y += 25) {
      const p = placePopup({ x: 700, y }, size, { w: 1440, top: 56, bottom: 700 }, null);
      if (p.hidden) { expect(y).toBeGreaterThan(692); continue; }
      expect(p.top).toBeGreaterThanOrEqual(64);
      expect(p.top + size.h).toBeLessThanOrEqual(692);
    }
  });
  it("clamps horizontally to the viewport", () => {
    expect(placePopup({ x: 10, y: 700 }, size, view, null).left).toBe(168);
    expect(placePopup({ x: 1439, y: 700 }, size, view, null).left).toBe(1440 - 168);
  });
});

describe("popup keeps the selection ring visible (Find on a short band)", () => {
  const clear = (p: ReturnType<typeof placePopup>, ring: { x: number; y: number; r: number }, w: number, h: number) => {
    const hh = p.maxH ?? h;
    const l = p.left - w / 2, r = p.left + w / 2, t = p.top, b = p.top + hh;
    // distance from the ring's bounding box to the popup box is at least 8 px on some axis
    return l >= ring.x + ring.r + 8 || r <= ring.x - ring.r - 8 || t >= ring.y + ring.r + 8 || b <= ring.y - ring.r - 8;
  };
  it("goes beside the ring when neither above nor below fits (1440x900, #37 centred)", () => {
    const ring = { x: 720, y: 449, r: 39 };
    const p = placePopup({ x: 720, y: 437 }, { w: 320, h: 459 }, { w: 1080, top: 56, bottom: 830 }, intro, 8, ring);
    expect(p.side).not.toBeNull();
    expect(clear(p, ring, 320, 459)).toBe(true);
    expect(p.pointerY).toBeGreaterThan(0);
  });
  it("scrolls in the roomier band when no side fits", () => {
    const ring = { x: 200, y: 300, r: 39 };
    const p = placePopup({ x: 200, y: 288 }, { w: 320, h: 600 }, { w: 420, top: 56, bottom: 700 }, null, 8, ring);
    expect(p.side).toBeNull();
    expect(p.maxH).not.toBeNull();
    expect(clear(p, ring, 320, 600)).toBe(true);
    expect(p.top + p.maxH!).toBeLessThanOrEqual(700 - 8);
  });
  it("above and below keep clear of the ring when they fit", () => {
    const ring = { x: 900, y: 712, r: 39 };
    const p = placePopup({ x: 900, y: 700 }, { w: 320, h: 300 }, { w: 1440, top: 56, bottom: 824 }, null, 8, ring);
    expect(clear(p, ring, 320, 300)).toBe(true);
  });
});
