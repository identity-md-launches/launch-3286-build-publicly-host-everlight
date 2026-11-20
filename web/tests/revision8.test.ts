import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MIN_SECTORS, sectorPlan } from "../src/garden/layout";
import { stairsOf } from "../src/garden/scenery";
import { fittingPrefix, planBatches } from "../src/lib/split";
import { explainError, isGasCapError } from "../src/lib/errors";
import { TX_GAS_CAP, MAX_BATCH } from "../src/config";
import type { PurchaseDeps } from "../src/lib/purchase";

/** Labelled mock storage: every write longer than `limit` characters throws QuotaExceededError. */
class QuotaStorage {
  m = new Map<string, string>();
  constructor(public limit = Infinity, public failIf: (v: string) => boolean = () => false) {}
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (v.length > this.limit || this.failIf(v)) throw new DOMException("full", "QuotaExceededError"); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}
// purchase intents are saved per account (review 658d1824); this is account 0x…a1's key
const INTENT = `0x${"0".repeat(62)}a1`;
const HASH = `0x${"b7".repeat(32)}` as const;

function mockDeps(storage: QuotaStorage, calls: string[], over: Partial<PurchaseDeps> = {}): PurchaseDeps {
  return {
    account: "0x00000000000000000000000000000000000000a1", storage: storage as unknown as Storage, chainId: () => 1, salesOpen: async () => true,
    balance: async () => 10n ** 20n, allowance: async () => 10n ** 20n, ethBalance: async () => 10n ** 18n,
    approve: async () => "0xa1", submission: async () => ({ nonce: 7, block: 100n }),
    simulate: async () => ({}), buy: async () => { calls.push("buy"); return HASH; },
    wait: async () => { calls.push("wait"); throw new Error("receipt read failed"); },
    explain: (e) => (e instanceof Error ? e.message : String(e)), ...over,
  };
}

describe("recovery intent before signing (finding 2fe5f5a4)", () => {
  it("a 64-character quota (the reviewer's scenario) blocks the send: the intent cannot be saved, so nothing is signed", async () => {
    vi.resetModules();
    const { runPurchase, STORAGE_MESSAGE } = await import("../src/lib/purchase");
    const st = new QuotaStorage(64);
    const calls: string[] = [];
    const r = await runPurchase(mockDeps(st, calls), [0], ["Keep this wish"], () => {});
    expect(r).toEqual({ name: "error", message: STORAGE_MESSAGE });
    expect(calls).toEqual([]);
  });
  it("a failed post-broadcast save keeps the intent; after a reload (fresh module) the form guard stays locked and one send is made", async () => {
    vi.resetModules();
    const m1 = await import("../src/lib/purchase");
    const st = new QuotaStorage(Infinity, (v) => v.includes(HASH)); // the intent fits, the entry with the hash does not
    const calls: string[] = [];
    const r = await m1.runPurchase(mockDeps(st, calls), [0], ["Keep this wish"], () => {});
    expect(r.name).toBe("buy-unknown");
    expect(calls).toEqual(["buy", "wait"]);
    // reload: a fresh module instance with the same storage object
    vi.resetModules();
    const m2 = await import("../src/lib/purchase");
    const saved = m2.pendingStore.list(st as unknown as Storage);
    expect(saved.map((t) => t.hash)).toEqual([INTENT]);
    expect(saved[0]).toMatchObject({ intent: true, kind: "buy", nonce: 7, block: "100", styles: [0], wishes: ["Keep this wish"] });
    // LightPanel's guard: running || a pending buy -> disabled; submit() returns early on the same check
    const locked = m2.isRunning(m2.purchaseFlow.get()) || saved.some((t) => t.kind === "buy");
    expect(locked).toBe(true);
    expect(calls.filter((c) => c === "buy")).toHaveLength(1);
  });
  it("a wallet rejection removes the intent; a settled purchase leaves nothing saved", async () => {
    vi.resetModules();
    const { runPurchase, pendingStore } = await import("../src/lib/purchase");
    const st = new QuotaStorage();
    const r = await runPurchase(mockDeps(st, [], { buy: async () => { throw new Error("User rejected the request."); } }), [1], [""], () => {});
    expect(r.name).toBe("error");
    expect(pendingStore.list(st as unknown as Storage)).toEqual([]);
    const ok = await runPurchase(mockDeps(st, [], {
      wait: async () => ({
        status: "success", hash: HASH, purchase: { purchaser: "0x00000000000000000000000000000000000000a1", firstId: 5, quantity: 1 },
        created: [{ id: 5, purchaser: "0x00000000000000000000000000000000000000a1", style: 1, wish: "" }],
        from: "0x00000000000000000000000000000000000000a1", to: "0x33a514c5e2028f1affd70b82f170e8193df030a5", call: { styles: [1], wishes: [""] },
      }),
    }), [1], [""], () => {});
    expect(ok.name).toBe("done");
    expect(pendingStore.list(st as unknown as Storage)).toEqual([]);
  });
});

describe("contract gas estimate re-plans the batch (finding 39004380)", () => {
  const long = Array.from({ length: 50 }, () => ({ style: 0, wish: "a".repeat(280) }));
  it("finds the largest ordered prefix under the cap and re-plans purchase 1 to it", async () => {
    const asked: number[] = [];
    const fits = async (k: number) => { asked.push(k); return k > 20 ? null : 9_000_000n; };
    const p = await fittingPrefix(30, fits);
    expect(p).toEqual({ n: 20, est: 9_000_000n });
    const before = planBatches(long);
    expect(before.map((b) => b.items.length)).toEqual([30, 20]);
    const after = planBatches(long, TX_GAS_CAP, MAX_BATCH, p.n);
    expect(after[0].items.length).toBe(20);
    expect(after.flatMap((b) => b.items)).toEqual(long); // every wish kept, in order
  });
  it("an RPC gas-cap refusal is a gas error, never an IMD approval error", () => {
    const e = new Error("gas required exceeds allowance (12000000)");
    expect(isGasCapError(e)).toBe(true);
    expect(explainError(e)).not.toMatch(/approval/i);
    expect(explainError(new Error("RESPLIT:20:9000000"))).toMatch(/first 20 candles/);
  });
});

describe("every raised terrace has a path connection (finding 7b461b68)", () => {
  it("terraces without a connected flight are ground-level beds; holder coordinates are unchanged", () => {
    let raised = 0, drawnRaised = 0, connected = 0, flush = 0;
    for (let i = 0; i < MIN_SECTORS; i++) {
      const p = sectorPlan(i), st = stairsOf(p);
      raised += p.terraces.filter((t) => t.rx > 0).length;
      flush += st.flush.size;
      p.terraces.forEach((t, ti) => {
        if (t.rx <= 0 || st.flush.has(ti)) return;
        drawnRaised++;
        expect(st.terraces.some((f) => f.terrace === ti && f.connected)).toBe(true);
      });
      connected += st.terraces.filter((f) => f.connected).length;
      expect(st.terraces.every((f) => f.connected)).toBe(true);
    }
    expect(drawnRaised).toBe(connected);
    expect(raised).toBe(drawnRaised + flush);
    expect(sectorPlan(0).slots[0]).toEqual([330, 470, 2.1]);
  });
});

describe("register discloses a known total while the first page is missing (finding 6fcf22b8)", () => {
  it("loading and failed first page both show 0 of the known total", async () => {
    const { Register } = await import("../src/panels/Panels");
    const html = (info: { total: number | null; loading: boolean; error: string | null }) =>
      renderToStaticMarkup(createElement(Register, { candles: [], info: { ...info, updatedAt: null }, onRetry: () => {}, onJump: () => {} }));
    expect(html({ total: 100, loading: true, error: null })).toContain("Showing 0 of 100 candles, loading the first page…");
    const failed = html({ total: 100, loading: false, error: "page failed" });
    expect(failed).toContain("Showing 0 of 100 candles. The first page could not be loaded.");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("count could not be read");
    expect(html({ total: null, loading: false, error: "rpc" })).toContain("could not be read");
  });
});
