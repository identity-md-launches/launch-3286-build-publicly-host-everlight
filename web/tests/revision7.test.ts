import { describe, expect, it } from "vitest";
import { TX_GAS_CAP } from "../src/config";
import { consumeDraft, planBatches } from "../src/lib/split";
import { motionPlan, shouldDraw } from "../src/garden/motion";
import { PENDING_STORAGE_KEY, buyIntentHash, pendingStore, runPurchase, STORAGE_MESSAGE, type PurchaseDeps, type Step } from "../src/lib/purchase";
import { CandleStore, type CandleSource } from "../src/lib/candles";
import { MIN_SECTORS, sectorPlan } from "../src/garden/layout";
import { stairsOf } from "../src/garden/scenery";
import { wishGardenAbi } from "../src/abi/WishGarden";

class MemStorage {
  m = new Map<string, string>();
  failSet: (k: string, v: string) => boolean = () => false;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.failSet(k, v)) throw new DOMException("full", "QuotaExceededError"); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

describe("split purchases (finding b12a45f5)", () => {
  const long = Array.from({ length: 50 }, (_, i) => ({ style: i % 7, wish: "a".repeat(280) }));
  it("splits 50 candles with 280-character wishes into ordered batches that each fit the gas cap", () => {
    const plan = planBatches(long);
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.every((b) => b.bound <= TX_GAS_CAP)).toBe(true);
    expect(plan.flatMap((b) => b.items)).toEqual(long);
    plan.forEach((b, i) => expect(b.start).toBe(i === 0 ? 0 : plan[i - 1].start + plan[i - 1].items.length));
  });
  it("keeps short drafts in one purchase and splits the largest legal wishes too", () => {
    expect(planBatches(Array.from({ length: 50 }, () => ({ style: 0, wish: "hi" }))).length).toBe(1);
    const huge = planBatches(Array.from({ length: 50 }, () => ({ style: 1, wish: "🐸".repeat(280) }))); // 1120 bytes each
    expect(huge.every((b) => b.bound <= TX_GAS_CAP && b.items.length >= 1)).toBe(true);
    expect(huge.reduce((a, b) => a + b.items.length, 0)).toBe(50);
  });
  it("a confirmed purchase removes exactly its candles from the front of the saved draft", () => {
    const same = { mode: "same" as const, custom: "50", style: 2, wish: "a".repeat(280) };
    const first = planBatches(Array.from({ length: 50 }, () => ({ style: 2, wish: same.wish })))[0];
    const n = first.items.length;
    const rest = consumeDraft(same, 50, Array(n).fill(2), Array(n).fill(same.wish));
    expect(rest).toMatchObject({ custom: String(50 - n), style: 2, wish: same.wish });
    const each = { mode: "each" as const, custom: "3", rows: [{ style: 0, wish: "x" }, { style: 1, wish: "y" }, { style: 2, wish: "z" }] };
    expect(consumeDraft(each, 3, [0], ["x"])).toMatchObject({ mode: "each", custom: "2", rows: [{ style: 1, wish: "y" }, { style: 2, wish: "z" }] });
    expect(consumeDraft(each, 3, [0, 1], ["x", "y"])).toMatchObject({ mode: "same", custom: "1", style: 2, wish: "z" });
    expect(consumeDraft(each, 3, [0, 1, 2], ["x", "y", "z"])).toBeNull();
    expect(consumeDraft(each, 3, [5], ["other"])).toEqual(each); // not this draft's leading candles: unchanged
  });
});

describe("water motion (finding b649ce8e)", () => {
  const base = { reducedMotion: false, hidden: false, igniting: false, waterInView: true };
  it("animates water with zero candles and at the default mobile zoom", () => {
    expect(motionPlan({ ...base, zoom: 1, candles: 0 }).animate).toBe(true);
    expect(motionPlan({ ...base, zoom: 0.62, candles: 100 }).animate).toBe(true);
    expect(motionPlan({ ...base, zoom: 0.62, candles: 0, waterInView: false }).animate).toBe(false);
  });
  it("stops for reduced motion and hidden tabs, and caps the frame rate", () => {
    expect(motionPlan({ ...base, reducedMotion: true, zoom: 1, candles: 0 }).animate).toBe(false);
    expect(motionPlan({ ...base, hidden: true, zoom: 1, candles: 5 }).animate).toBe(false);
    const plan = motionPlan({ ...base, zoom: 1, candles: 0 });
    let last = -Infinity, draws = 0;
    for (let f = 0; f < 120; f++) { const t = f * (1000 / 60); if (shouldDraw(plan, false, t, last)) { draws++; last = t; } }
    expect(draws).toBeGreaterThanOrEqual(38); // 2 s of 60 Hz frames at the 20 fps water cap
    expect(draws).toBeLessThanOrEqual(41);
  });
});

function deps(storage: MemStorage, calls: string[]): PurchaseDeps {
  return {
    account: "0xabc", storage: storage as unknown as Storage, chainId: () => 1, salesOpen: async () => true,
    balance: async () => 10n ** 20n, allowance: async () => 10n ** 20n, ethBalance: async () => 10n ** 18n,
    approve: async () => "0xa1", submission: async () => ({ nonce: 1, block: 5n }),
    simulate: async () => ({}), buy: async () => { calls.push("buy"); return "0xb7"; },
    wait: async () => { calls.push("wait"); throw new Error("no receipt yet"); },
    explain: (e) => (e instanceof Error ? e.name || e.message : String(e)),
  };
}

describe("storage failures around a purchase (finding 1adfd347)", () => {
  it("does not ask the wallet to sign when recovery data cannot be saved", async () => {
    const st = new MemStorage(); st.failSet = () => true;
    const calls: string[] = [];
    const r = await runPurchase(deps(st, calls), [0], ["Keep this wish"], () => {});
    expect(r).toEqual({ name: "error", message: STORAGE_MESSAGE });
    expect(calls).toEqual([]);
  });
  it("a storage failure after broadcast keeps the hash pending and the draft locked", async () => {
    // the recovery intent is saved before signing; saving the sent hash over it fails (revision 8: intent first)
    const st = new MemStorage(); st.failSet = (_k, v) => v.includes('"0xb7"');
    const calls: string[] = [];
    const steps: Step[] = [];
    const r = await runPurchase(deps(st, calls), [0], ["Keep this wish"], (s) => steps.push(s));
    expect(calls).toEqual(["buy", "wait"]);
    expect(r.name).toBe("buy-unknown");
    expect(steps.some((s) => s.name === "buy-pending")).toBe(true);
    // revision 12: one attempt id. Storage still holds the intent (a reload resolves it); this page overlays the sent
    // hash held in memory for the same attempt, so the UI guard locks on the real hash
    expect(pendingStore.list(st as unknown as Storage).map((t) => t.hash)).toEqual(["0xb7"]);
    expect(JSON.parse(st.getItem(PENDING_STORAGE_KEY) ?? "[]").map((t: { hash: string }) => t.hash)).toEqual([buyIntentHash("0xabc")]);
  });
});

describe("candle register count (finding 4bbfc677)", () => {
  it("an RPC failure leaves the total unknown, never zero", async () => {
    const src: CandleSource = { total: async () => { throw new Error("RPC unavailable"); }, page: async () => [], one: async () => null, idsOf: async () => [] } as unknown as CandleSource;
    const s = new CandleStore(src);
    await s.sync();
    expect(s.state.total).toBeNull();
    expect(s.state.error).toBe("RPC unavailable");
  });
});

describe("terraces are joined to the paths (finding 2fd0db9a)", () => {
  const plans = Array.from({ length: MIN_SECTORS }, (_, i) => sectorPlan(i));
  it("most raised terraces carry steps, and most flights reach the path directly or through neighbours", () => {
    let raised = 0, flights = 0, connected = 0;
    for (const p of plans) {
      const st = stairsOf(p);
      raised += p.terraces.filter((t) => t.rx > 0).length;
      flights += st.terraces.length;
      connected += st.terraces.filter((f) => f.connected).length;
      for (const f of st.terraces) for (const [x0, y0, x1, y1] of f.links ?? []) for (const [x, y, sc] of p.slots) {
        // no leg passes through a holder
        const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8) || 1;
        for (let i = 2; i < n - 1; i++) {
          const px = x0 + ((x1 - x0) * i) / n, py = y0 + ((y1 - y0) * i) / n;
          expect(Math.abs(px - x) < 14 + 16 && py + 6 > y - 84 * sc && py - 6 < y + 6).toBe(false);
        }
      }
    }
    // revision 8: unreachable flights are dropped and their terraces drawn as ground-level beds (see revision8.test.ts)
    expect(flights).toBe(connected);
    expect(connected / raised).toBeGreaterThan(0.72);
  });
});

it("RewardAllocated names its last field fallbackToBurn, as in the pinned ABI (finding 81cb0dd6)", () => {
  const ev = wishGardenAbi.find((e) => e.type === "event" && e.name === "RewardAllocated") as unknown as { inputs: { name: string }[] };
  expect(ev.inputs[3].name).toBe("fallbackToBurn");
});
