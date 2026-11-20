import { describe, expect, it, vi } from "vitest";
import { checkWish, gasBound } from "../src/lib/wish";
import { CandleStore, fixtureSource, readAllIds } from "../src/lib/candles";
import { hitTest, positionOf, sectorAt, sectorCount, sectorPlan, spiral, streamX, pathY, worldBounds, SECTOR_H, SECTOR_W, SLOTS_PER_SECTOR } from "../src/garden/layout";
import { awaitBuy, pendingStore, FIXTURE_MESSAGE, META_MESSAGE, REPLACED_MESSAGE, UNVERIFIED_MESSAGE, runPurchase, type PurchaseDeps, type Step } from "../src/lib/purchase";
import { GARDEN } from "../src/config";
import { IGNITE_MS, ignite, ignition, igniting, newIds } from "../src/garden/ignite";

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
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
  it("the empty garden already holds at least 10,000 unlit holders, then grows one sector ahead", () => {
    for (const n of [0, 100, 3000, 10000]) expect(sectorCount(n) * SLOTS_PER_SECTOR).toBeGreaterThanOrEqual(10000);
    expect(sectorCount(0)).toBe(105);
    expect(sectorCount(10080)).toBe(106);
    expect(sectorCount(20000)).toBe(Math.floor(20000 / SLOTS_PER_SECTOR) + 1);
    const b = worldBounds(0);
    const far = positionOf(9999);
    expect(far.x >= b.minX && far.x <= b.maxX && far.y >= b.minY && far.y <= b.maxY).toBe(true);
    expect(hitTest(far.x, far.y - 30 * far.scale, 0, 10)).toBe(9999); // addressable before any purchase
  });
  it("hit test covers the flame and holder, not only the body (founding candle at 2.1x)", () => {
    const p = positionOf(0);
    expect(p.scale).toBeCloseTo(2.1);
    expect(hitTest(p.x, p.y - 66 * p.scale, 100, 22 / 1.4)).toBe(0); // flame centre
    expect(hitTest(p.x, p.y - 42 * p.scale, 100, 22 / 1.4)).toBe(0); // body
    expect(hitTest(p.x, p.y - 4, 100, 22 / 1.4)).toBe(0); // holder foot
  });
  it("hit test finds the candle under the pointer", () => {
    const p = positionOf(4321);
    expect(hitTest(p.x, p.y - 20, 10000, 20)).toBe(4321);
  });
  it("inverts the sector spiral in closed form with no cap", () => {
    for (let n = 0; n < 20000; n++) { const [x, y] = spiral(n); expect(sectorAt(x, y)).toBe(n); }
    for (const n of [4096, 99999, 393216, 1234567]) { const [x, y] = spiral(n); expect(sectorAt(x, y)).toBe(n); }
  });
  it("hit test works past 4,096 sectors (400,000 candles)", () => {
    const p = positionOf(4096 * SLOTS_PER_SECTOR + 7);
    expect(hitTest(p.x, p.y - 42 * p.scale, 400000, 30)).toBe(4096 * SLOTS_PER_SECTOR + 7);
  });
  it("fills every sector with holders that avoid the stream and path", () => {
    for (let s = 0; s < 120; s++) {
      const plan = sectorPlan(s);
      expect(plan.slots.length).toBe(SLOTS_PER_SECTOR);
      for (const [x, y] of plan.slots.slice(s === 0 ? 1 : 0)) {
        expect(Math.abs(x - streamX(plan.gx, y))).toBeGreaterThan(60);
        expect(Math.abs(y - pathY(plan.gy, x))).toBeGreaterThan(40);
      }
    }
  });
  it("is not a repeated tile: sectors differ and terraces are curved arcs", () => {
    const a = sectorPlan(1).slots.map(([x, y]) => [x % SECTOR_W, y % SECTOR_H].map(Math.round).join());
    const b = sectorPlan(5).slots.map(([x, y]) => [((x % SECTOR_W) + SECTOR_W) % SECTOR_W, ((y % SECTOR_H) + SECTOR_H) % SECTOR_H].map(Math.round).join());
    expect(a.filter((k) => b.includes(k)).length).toBeLessThan(3);
    for (let n = 0; n < 5000; n++) expect(spiral(n)[1]).toBeGreaterThanOrEqual(0); // never north of the home row
    const ys = new Set(sectorPlan(2).slots.map(([, y]) => Math.round(y / 4)));
    expect(ys.size).toBeGreaterThan(40); // no flat rows
  });
  it("streams and paths join across sector edges", () => {
    for (let gy = -3; gy < 3; gy++) {
      const y = gy * SECTOR_H;
      expect(streamX(2, y - 0.001)).toBeCloseTo(streamX(2, y + 0.001), 1);
    }
    for (let gx = -3; gx < 3; gx++) {
      const x = gx * SECTOR_W;
      expect(pathY(1, x - 0.001)).toBeCloseTo(pathY(1, x + 0.001), 1);
    }
  });
  it("world bounds contain every sector", () => {
    for (const total of [0, 100, 3000, 10000]) {
      const b = worldBounds(total);
      for (let s = 0; s < sectorCount(total); s++) {
        const p = positionOf(s * SLOTS_PER_SECTOR);
        expect(p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY).toBe(true);
      }
    }
  });
});

/** A complete mined receipt as the live adapter reads it: events, sender, target and decoded calldata. */
function mined(h: string, firstId: number, styles: number[], wishes: string[], buyer = "0xABC") {
  return {
    status: "success" as const, hash: h as `0x${string}`, from: buyer, to: GARDEN, call: { styles, wishes },
    purchase: { purchaser: buyer, firstId, quantity: styles.length },
    created: styles.map((st, i) => ({ id: firstId + i, purchaser: buyer, style: st, wish: wishes[i] })),
  };
}

function deps(over: Partial<PurchaseDeps> = {}): PurchaseDeps & { calls: string[] } {
  const calls: string[] = [];
  let allowance = 0n;
  let last: { styles: number[]; wishes: string[] } = { styles: [], wishes: [] };
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
    wait: async (h) => { calls.push(`wait:${h}`); return mined(h, 7, last.styles, last.wishes); },
    submission: async () => ({ nonce: 9, block: 1000n }),
    simulate: async (s, w) => { calls.push(`simulate:${s.length}:${w.length}`); last = { styles: s, wishes: w }; return { req: true }; },
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
    expect(r).toEqual({ name: "done", hash: "0xb1", firstId: 7, quantity: 3 });
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
  it("keeps the pending hash and stays locked when the RPC fails while waiting (reload recovery)", async () => {
    const d = deps({ allowance: async () => 10n ** 30n, wait: async () => { throw new Error("HTTP request failed"); } });
    const r = await runPurchase(d, [1], [""], () => {});
    expect(r).toMatchObject({ name: "buy-unknown", hash: "0xb1" });
    expect(pendingStore.list(d.storage).map((t) => t.hash)).toEqual(["0xb1"]);
  });
  it("a successful replacement without the garden event is not a purchase (cancelled in the wallet)", async () => {
    const remembered: unknown[] = [];
    const d = deps({ allowance: async () => 10n ** 30n, remember: (...a) => remembered.push(a), wait: async () => ({ status: "success", hash: "0xc3", purchase: null }) });
    const r = await runPurchase(d, [1, 2, 3], ["a", "b", "c"], () => {});
    expect(r).toEqual({ name: "error", message: REPLACED_MESSAGE });
    expect(remembered).toEqual([]);
    expect(pendingStore.list(d.storage)).toEqual([]);
  });
  it("a sped-up purchase links the mined replacement hash, not the sent one", async () => {
    const remembered: unknown[] = [];
    const d = deps({
      allowance: async () => 10n ** 30n,
      remember: (...a) => remembered.push(a),
      wait: async () => mined("0xc3", 1, [0, 1, 2], ["", "", ""], "0xabc"),
    });
    const r = await runPurchase(d, [0, 1, 2], ["", "", ""], () => {});
    expect(r).toEqual({ name: "done", hash: "0xc3", firstId: 1, quantity: 3 });
    expect(remembered).toEqual([[1, 3, "0xc3"]]);
  });
  it("an event for another buyer or quantity does not complete the purchase", async () => {
    const other = await runPurchase(deps({ allowance: async () => 10n ** 30n, wait: async () => mined("0xc3", 1, [1], [""], "0xdef") }), [1], [""], () => {});
    expect(other).toEqual({ name: "error", message: REPLACED_MESSAGE });
    const two = await runPurchase(deps({ allowance: async () => 10n ** 30n, wait: async () => mined("0xc3", 1, [1, 1], ["", ""]) }), [1], [""], () => {});
    expect(two).toMatchObject({ name: "error", hash: "0xc3", message: expect.stringContaining("different candle purchase") });
  });
  it("fixture pages are read-only: nothing reaches the wallet", async () => {
    const d = deps({ readOnly: true, allowance: async () => 10n ** 30n });
    const r = await runPurchase(d, [0], [""], () => {});
    expect(r).toEqual({ name: "error", message: FIXTURE_MESSAGE });
    expect(d.calls).toEqual([]);
  });
  it("a failed nonce/block read stops before the wallet signs (no unrecoverable pending purchase)", async () => {
    const d = deps({ allowance: async () => 10n ** 30n, submission: async () => { throw new Error("RPC unavailable"); } });
    const r = await runPurchase(d, [0], ["original"], () => {});
    expect(r).toEqual({ name: "error", message: META_MESSAGE });
    expect(d.calls).not.toContain("buy");
    expect(pendingStore.list(d.storage)).toEqual([]);
  });
  it("persists sender, nonce and block, then reconciles the nonce with the submitted transaction", async () => {
    let saved: unknown = null;
    const d = deps({
      allowance: async () => 10n ** 30n,
      submission: async () => ({ nonce: 9, block: 1000n }),
      sentTx: async () => ({ from: "0xabc", nonce: 11 }),
      wait: async (_h, tx) => { saved = pendingStore.list(d.storage)[0]; expect(tx?.nonce).toBe(11); throw new Error("pending"); },
    });
    const r = await runPurchase(d, [0], ["original"], () => {});
    expect(r.name).toBe("buy-unknown");
    expect(saved).toMatchObject({ hash: "0xb1", from: "0xabc", nonce: 11, block: "1000", nonceChecked: true, styles: [0], wishes: ["original"] });
  });
  it("keeps the preflight nonce and block when the sent transaction cannot be read yet", async () => {
    const d = deps({ allowance: async () => 10n ** 30n, sentTx: async () => null, wait: async () => { throw new Error("pending"); } });
    await runPurchase(d, [0], ["original"], () => {});
    expect(pendingStore.list(d.storage)[0]).toMatchObject({ from: "0xabc", nonce: 9, block: "1000", nonceChecked: false });
  });
});

describe("purchase recovery after a reload (labelled mock chain)", () => {
  const tx = { hash: "0xa0" as const, kind: "buy" as const, account: "0xabc", quantity: 3, createdAt: 1 };
  const setup = () => { const storage = new MemStorage() as unknown as Storage; pendingStore.add(tx, storage); return storage; };
  it("settles a verified purchase from the replacement receipt and clears the pending hash", async () => {
    const storage = setup();
    const remembered: unknown[] = [];
    const steps: Step[] = [];
    const s = await awaitBuy({ storage, explain: String, remember: (...a) => remembered.push(a), wait: async () => mined("0xb0", 4, [0, 0, 0], ["", "", ""], "0xabc") }, tx, (x) => steps.push(x));
    expect(s).toEqual({ name: "done", hash: "0xb0", firstId: 4, quantity: 3 });
    expect(remembered).toEqual([[4, 3, "0xb0"]]);
    expect(pendingStore.list(storage)).toEqual([]);
  });
  it("a cancelled purchase is a failure that releases the draft for retry", async () => {
    const storage = setup();
    const s = await awaitBuy({ storage, explain: String, wait: async () => ({ status: "success", hash: "0xb0", purchase: null }) }, tx, () => {});
    expect(s).toEqual({ name: "error", message: REPLACED_MESSAGE });
    expect(pendingStore.list(storage)).toEqual([]);
  });
  it("a receipt whose transaction could not be read stays pending (no settle without calldata)", async () => {
    const storage = setup();
    const { from, to, call, ...noTx } = mined("0xb0", 4, [0, 0, 0], ["", "", ""], "0xabc");
    void from; void to; void call;
    const s = await awaitBuy({ storage, explain: String, wait: async () => noTx }, tx, () => {});
    expect(s).toEqual({ name: "buy-unknown", hash: "0xa0", message: UNVERIFIED_MESSAGE });
    expect(pendingStore.list(storage).map((t) => t.hash)).toEqual(["0xa0"]);
  });
  it("no receipt keeps the hash pending (the form stays locked)", async () => {
    const storage = setup();
    const s = await awaitBuy({ storage, explain: () => "no receipt", wait: async () => { throw new Error("timeout"); } }, tx, () => {});
    expect(s).toEqual({ name: "buy-unknown", hash: "0xa0", message: "no receipt" });
    expect(pendingStore.list(storage).map((t) => t.hash)).toEqual(["0xa0"]);
  });
  it("a failing simulation never requests the purchase", async () => {
    const d = deps({ allowance: async () => 10n ** 30n, simulate: async () => { throw new Error("PurchasesDisabled"); } });
    await runPurchase(d, [1], [""], () => {});
    expect(d.calls).not.toContain("buy");
  });
});

describe("Find beyond the streamed pages", () => {
  const failing = (n: number, okUpTo: number, oneFails = false) => {
    const src = fixtureSource(n);
    return {
      ...src,
      async page(first: number, limit: number) {
        if (first > okUpTo) throw new Error("RPC down");
        return src.page(first, limit);
      },
      async one(id: number) {
        if (oneFails) throw new Error("RPC down");
        return src.one(id);
      },
    };
  };
  it("uses the onchain total, not the loaded count, and reads the record with getCandle", async () => {
    const s = new CandleStore(failing(3000, 100), null);
    await s.sync();
    expect(s.state.candles.length).toBe(100);
    expect(s.state.total).toBe(3000);
    const r = await s.lookup(3000);
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.candle.id).toBe(3000);
    expect(await s.lookup(3001)).toEqual({ kind: "none", total: 3000 });
  });
  it("throws (retryable) when the record cannot be read, instead of claiming it does not exist", async () => {
    const s = new CandleStore(failing(3000, 100, true), null);
    await s.sync();
    await expect(s.lookup(3000)).rejects.toThrow();
  });
});

describe("ignition after a verified purchase", () => {
  it("runs once from unlit to lit; candles never ignited are drawn fully lit", () => {
    expect(ignition(5, 0)).toBe(1);
    ignite(newIds(41, 3), 1000);
    expect(ignition(41, 1000)).toBe(0);
    expect(ignition(43, 1000 + IGNITE_MS / 2)).toBeCloseTo(0.5);
    expect(igniting()).toBe(true);
    for (const id of [41, 42, 43]) expect(ignition(id, 1000 + IGNITE_MS)).toBe(1);
    expect(igniting()).toBe(false);
  });
});
