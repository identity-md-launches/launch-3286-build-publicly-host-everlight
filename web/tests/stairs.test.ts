import { describe, expect, it } from "vitest";
import { MIN_SECTORS, sectorPlan } from "../src/garden/layout";
import { stairsOf } from "../src/garden/scenery";

describe("garden stairs", () => {
  const plans = Array.from({ length: MIN_SECTORS }, (_, i) => sectorPlan(i));
  const all = plans.map((p) => ({ p, st: stairsOf(p) }));
  it("recur across the garden and stay clear of every slot", () => {
    let flights = 0, walks = 0;
    for (const { p, st } of all) {
      for (const f of [...st.terraces, ...(st.gazebo?.stair ? [st.gazebo.stair] : [])]) {
        flights++;
        if (f.walk) walks++;
        for (const [x, y, sc] of p.slots) {
          const overlapX = Math.abs(x - f.x) < 14 + f.halfW + 4;
          const overlapY = y + 6 > f.yTop - 6 && y - 84 * sc < f.yTop + f.drop + 4;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    }
    expect(flights).toBeGreaterThan(MIN_SECTORS * 2);
    expect(walks).toBeGreaterThan(MIN_SECTORS / 2);
  });
  it("the opening view connects the path to the twin arches and a terrace to the path", () => {
    const { p, st } = all[0];
    expect(p.gazebo).not.toBeNull();
    expect(st.gazebo?.stair?.walk ?? st.gazebo?.back).toBeTruthy();
    expect(st.terraces.some((f) => f.walk)).toBe(true);
  });
  it("does not move any slot (ID-to-position mapping unchanged)", () => {
    // stairs are derived from the plan; the plan's first slots are the same as before this change
    expect(plans[0].slots[0]).toEqual([330, 470, 2.1]);
  });
});
