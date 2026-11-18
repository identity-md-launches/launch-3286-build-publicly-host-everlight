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
