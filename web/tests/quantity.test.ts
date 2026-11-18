import { describe, expect, it } from "vitest";
import { parseQuantity } from "../src/lib/quantity";

describe("parseQuantity: only whole numbers 1-50, never clamped or rounded", () => {
  it.each(["1", "7", "50", " 12 "])("accepts %s", (v) => {
    const r = parseQuantity(v);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.n).toBe(Number(v.trim()));
  });
  it.each(["51", "0", "2.5", "-3", "abc", "", "1e1", "+5", "100", "0x10"])("rejects %s visibly", (v) => {
    const r = parseQuantity(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
  });
});
