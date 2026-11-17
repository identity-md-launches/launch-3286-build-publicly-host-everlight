import { describe, expect, it, vi } from "vitest";
import { checkWish, gasBound } from "../src/lib/wish";
import { CandleStore, fixtureSource, readAllIds } from "../src/lib/candles";
import { hitTest, positionOf, sectorCount, SLOTS_PER_SECTOR } from "../src/garden/layout";
import { pendingStore, runPurchase, type PurchaseDeps, type Step } from "../src/lib/purchase";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

describe("wish limits mirror Utf8Wish.validate", () => {
  it("accepts 280 ASCII code points and rejects 281", () => {
    expect(checkWish("a".repeat(280)).ok).toBe(true);
    expect(checkWish("a".repeat(281)).ok).toBe(false);
  });
  it("counts astral emoji as one code point and four bytes", () => {
    const c = checkWish("🐸");
    expect(c.codepoints).toBe(1);
    expect(c.bytes).toBe(4);
  });
  it("280 emoji = 1120 bytes passes; 280 code points over 1120 bytes is impossible but bytes are enforced", () => {
    expect(checkWish("🐸".repeat(280)).ok).toBe(true);
    expect(checkWish("🐸".repeat(281)).ok).toBe(false);
  });
  it("rejects lone surrogates (invalid UTF-8 onchain)", () => {
    expect(checkWish("a\ud800b").ok).toBe(false);
  });
  it("gas bound follows the contract docs", () => {
    expect(gasBound(50, 0)).toBe(8_800_000n);
    expect(gasBound(10, 11200) < 16_777_216n).toBe(true);
    expect(gasBound(50, 50 * 280) > 16_777_216n).toBe(true);
  });
});

describe("candle store: paginated incremental reads on fixtures", () => {
  for (const n of [0, 100, 3000, 10000]) {
    it(`loads ${n} candles in pages of at most 100`, async () => {
      const src = fixtureSource(n);
      const spy = vi.spyOn(src, "page");
      const store = new CandleStore(src, new MemStorage() as unknown as Storage);
      let updates = 0;
      store.subscribe(() => updates++);
      await store.sync();
      expect(store.state.candles.length).toBe(n);
      expect(store.state.total).toBe(n);
      expect(spy).toHaveBeenCalledTimes(Math.ceil(n / 100));
      for (const call of spy.mock.calls) expect(call[1]).toBeLessThanOrEqual(100);
      expect(store.state.candles.every((c, i) => c.id === i + 1)).toBe(true);
      // second sync reads nothing new
      spy.mockClear();
      await store.sync();
      expect(spy).not.toHaveBeenCalled();
    });
  }
  it("rejects pages over 100 like the contract", async () => {
    await expect(fixtureSource(500).page(1, 101)).rejects.toThrow("InvalidPage");
  });
  it("candleIdsOf pagination stops at the end", async () => {
    const all = Array.from({ length: 250 }, (_, i) => BigInt(i + 1));
    const read = vi.fn(async (o: bigint, l: bigint) => {
      const ids = all.slice(Number(o), Number(o + l));
      return [ids, o + BigInt(ids.length)] as const;
    });
    const ids = await readAllIds(read);
    expect(ids.length).toBe(250);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe("garden layout", () => {
  it("is deterministic and unique per position", () => {
    const seen = new Set<string>();
    for (let p = 0; p < 10000; p++) {
      const a = positionOf(p);
      const key = `${Math.round(a.x)},${Math.round(a.y)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(positionOf(1234)).toEqual(positionOf(1234));
  });
  it("shows one extra sector of empty holders", () => {
    expect(sectorCount(0)).toBe(1);
    expect(sectorCount(SLOTS_PER_SECTOR)).toBe(2);
  });
  it("hit test finds the candle under the pointer", () => {
    const p = positionOf(4321);
    expect(hitTest(p.x, p.y - 20, 10000, 20)).toBe(4321);
  });
});

function deps(over: Partial<PurchaseDeps> = {}): PurchaseDeps & { calls: string[] } {
  const calls: string[] = [];
  let allowance = 0n;
  const d: PurchaseDeps & { calls: string[] } = {
    calls,
    account: "0xabc",
    storage: new MemStorage() as unknown as Storage,
    chainId: () => 1,
    salesOpen: async () => true,
    balance: async () => 100n * 10n ** 18n,
    allowance: async () => allowance,
    ethBalance: async () => 10n ** 18n,
    approve: async (amt) => { calls.push(`approve:${amt}`); allowance = amt; return "0xa1" as const; },
    wait: async (h) => { calls.push(`wait:${h}`); return { status: "success", firstId: 7 }; },
    simulate: async (s, w) => { calls.push(`simulate:${s.length}:${w.length}`); return { req: true }; },
    buy: async () => { calls.push("buy"); return "0xb1" as const; },
    explain: (e) => (e instanceof Error ? e.message : String(e)),
    ...over,
  };
  return d;
}

describe("purchase flow (labelled mock chain, no real funds)", () => {
  it("approves exactly the total, waits, simulates, then buys", async () => {
    const d = deps();
    const steps: Step[] = [];
    const r = await runPurchase(d, [0, 3, 6], ["", "hi", "🐸"], (s) => steps.push(s));
    expect(r).toEqual({ name: "done", hash: "0xb1", firstId: 7 });
    expect(d.calls).toEqual([`approve:${3n * 10n ** 18n}`, "wait:0xa1", "simulate:3:3", "buy", "wait:0xb1"]);
    expect(steps.map((s) => s.name)).toEqual(["checking", "approve-wallet", "approve-pending", "simulating", "buy-wallet", "buy-pending", "done"]);
    expect(pendingStore.list(d.storage)).toEqual([]);
  });
  it("skips approval when allowance covers the total", async () => {
    const d = deps({ allowance: async () => 10n ** 30n });
    await runPurchase(d, [1], [""], () => {});
    expect(d.calls[0]).toBe("simulate:1:1");
  });
  it("stops when sales are closed", async () => {
    const d = deps({ salesOpen: async () => false });
    const r = await runPurchase(d, [1], [""], () => {});
    expect(r.name).toBe("error");
    expect(d.calls).toEqual([]);
  });
  it("stops on the wrong network", async () => {
    const r = await runPurchase(deps({ chainId: () => 8453 }), [1], [""], () => {});
    expect(r).toMatchObject({ name: "error", message: expect.stringContaining("Ethereum") });
  });
  it("stops on insufficient IMD", async () => {
    const r = await runPurchase(deps({ balance: async () => 10n ** 17n }), [1, 1], ["", ""], () => {});
    expect(r).toMatchObject({ name: "error", message: expect.stringContaining("2 IMD") });
  });
  it("reports wallet cancellation without buying", async () => {
    const d = deps({ approve: async () => { throw new Error("User rejected the request"); }, explain: () => "cancelled" });
    const r = await runPurchase(d, [1], [""], () => {});
    expect(r).toEqual({ name: "error", message: "cancelled" });
    expect(d.calls).not.toContain("buy");
  });
  it("reports a reverted purchase and keeps no pending hash", async () => {
    const d = deps({ allowance: async () => 10n ** 30n, wait: async () => ({ status: "reverted" }) });
    const r = await runPurchase(d, [1], [""], () => {});
    expect(r).toMatchObject({ name: "error", message: expect.stringContaining("reverted") });
    expect(pendingStore.list(d.storage)).toEqual([]);
  });
  it("keeps the pending hash when the RPC fails while waiting (reload recovery)", async () => {
    const d = deps({ allowance: async () => 10n ** 30n, wait: async () => { throw new Error("HTTP request failed"); } });
    const r = await runPurchase(d, [1], [""], () => {});
    expect(r.name).toBe("error");
    expect(pendingStore.list(d.storage).map((t) => t.hash)).toEqual(["0xb1"]);
  });
  it("a failing simulation never requests the purchase", async () => {
    const d = deps({ allowance: async () => 10n ** 30n, simulate: async () => { throw new Error("PurchasesDisabled"); } });
    await runPurchase(d, [1], [""], () => {});
    expect(d.calls).not.toContain("buy");
  });
});
