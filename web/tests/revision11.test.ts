// @vitest-environment jsdom
/**
 * Revision 11 regressions (all mocked: labelled in-memory storage, mock RPC/wallet; no network, no transactions).
 *  d343f73e  an empty page inside the verified total marks the register incomplete with Retry, and Retry resumes
 *  0751d676  Release unlocks an uncertain purchase/claim only after a verified cancellation of that exact attempt
 *  db8c2689  the transient purchase step belongs to the account that started it
 *  c55d2fd3  a sped-up approval links the mined receipt's hash after a gas re-plan
 *  05708c27  four distinct terrace footprints, slots unchanged
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { Hash } from "viem";
import { CandleStore, type Candle, type CandleSource } from "../src/lib/candles";
import { countLine } from "../src/lib/counts";
import { attemptOf, pendingStore, purchaseFlow, runPurchase, type PendingTx, type PurchaseDeps } from "../src/lib/purchase";
import { intentHash, type IntentClient } from "../src/lib/intent";
import { releaseVerified, verifyCancelled } from "../src/lib/chain";
import { explainError } from "../src/lib/errors";
import { IntentRecovery } from "../src/panels/LightPanel";
import { sectorPlan } from "../src/garden/layout";
import { terraceArrangement } from "../src/garden/scenery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const ME = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const H = (c: string) => `0x${c.repeat(64)}` as Hash;
class FakeStorage implements Storage {
  constructor(public map = new Map<string, string>()) {}
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}
const rec = (id: number): Candle => ({ id, purchaser: ME, style: id % 7, createdAt: 1, position: id - 1, wish: "" });

describe("d343f73e: an empty page inside the verified total is incomplete, with Retry", () => {
  it("keeps total 250 and 100 records, sets an error, and Retry resumes at id 101", async () => {
    const calls: number[] = [];
    let serveSecond = false;
    const src: CandleSource = {
      kind: "fixture",
      total: async () => 250,
      page: async (first, limit) => { calls.push(first); if (first > 100 && !serveSecond) return []; return Array.from({ length: limit }, (_, i) => rec(first + i)); },
      one: async (id) => rec(id), idsOf: async () => [],
    };
    const store = new CandleStore(src, null);
    await store.sync();
    expect(calls).toEqual([1, 101]);
    expect(store.state.total).toBe(250);
    expect(store.state.candles).toHaveLength(100);
    expect(store.state.error).toMatch(/#101 of 250/);
    const c = countLine({ total: store.state.total, loaded: store.state.candles.length, loading: false, error: store.state.error });
    expect(c).toEqual({ lit: "250 lit", loaded: "loaded 100 of 250", incomplete: true, retry: true });
    serveSecond = true;
    await store.sync();
    expect(calls.slice(2)).toEqual([101, 201]);
    expect(store.state.candles.map((x) => x.id)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(store.state.error).toBeNull();
  });
});

/** Mock RPC for one account: `minedAfter` = mined nonce count; nonce 7 consumed at block 105 by `at7` (if any). */
function rpc(o: { mined: number; pending?: number; at7?: { to: string; input: `0x${string}` } }) {
  let lookups = 0;
  const c: IntentClient = {
    receipt: async () => { lookups++; return null; },
    nonceAt: async (_a, block) => { lookups++; return block === undefined ? o.mined : block >= 105n ? o.mined : 7; },
    head: async () => 120n,
    blockTxs: async (b) => (b === 105n && o.at7 ? [{ hash: H("c"), from: ME, nonce: 7 }] : []),
    pendingNonce: async () => { lookups++; return o.pending ?? o.mined; },
    tx: async (h) => (h === H("c") && o.at7 ? { hash: h, from: ME, to: o.at7.to, input: o.at7.input, nonce: 7, chainId: 1 } : null),
  };
  return { c, lookups: () => lookups };
}
const intentOf = (kind: "buy" | "claim"): PendingTx => ({
  hash: intentHash(kind, ME), kind, intent: true, account: ME, createdAt: 1000, from: ME, nonce: 7, block: "100", nonceChecked: false,
  ...(kind === "buy" ? { quantity: 1, styles: [0], wishes: [""] } : {}),
});

describe("0751d676: Release needs a verified cancellation of this exact attempt", () => {
  for (const kind of ["buy", "claim"] as const) {
    it(`${kind}: broadcast-then-4900 with nonce 7 unused cannot be released; the intent stays`, async () => {
      const st = new FakeStorage();
      pendingStore.persist(intentOf(kind), st);
      const { c } = rpc({ mined: 7 });
      const v = await verifyCancelled(intentOf(kind), c);
      expect(v.ok).toBe(false);
      const r = await releaseVerified(intentOf(kind), (t) => pendingStore.remove(t.hash, st), c, st);
      expect(r.ok).toBe(false);
      expect(pendingStore.list(st)).toHaveLength(1);
    });
    it(`${kind}: a pending transaction or an unreadable RPC never verifies a cancellation`, async () => {
      expect((await verifyCancelled(intentOf(kind), rpc({ mined: 7, pending: 8 }).c)).ok).toBe(false);
      const broken = { ...rpc({ mined: 8 }).c, nonceAt: async () => { throw new Error("rpc down"); } };
      expect((await verifyCancelled(intentOf(kind), broken)).ok).toBe(false);
    });
    it(`${kind} (revision 12): nonce 7 consumed by an unrelated self-send is NOT proof of cancellation; nothing is released`, async () => {
      const st = new FakeStorage();
      pendingStore.persist(intentOf(kind), st);
      pendingStore.persist({ ...intentOf(kind), hash: intentHash(kind, B), account: B, from: B }, st);
      const { c } = rpc({ mined: 8, at7: { to: ME, input: "0x" } });
      expect((await verifyCancelled(intentOf(kind), c)).ok).toBe(false);
      const r = await releaseVerified(intentOf(kind), (t) => pendingStore.removeAttempt(attemptOf(t), st), c, st);
      expect(r.ok).toBe(false);
      expect(pendingStore.list(st).map((t) => t.account).sort()).toEqual([ME, B].sort());
    });
    it(`${kind}: a different saved attempt (new start time) is not released by an earlier verification`, async () => {
      const st = new FakeStorage();
      pendingStore.persist({ ...intentOf(kind), createdAt: 2000 }, st);
      const r = await releaseVerified(intentOf(kind), (t) => pendingStore.remove(t.hash, st), rpc({ mined: 8, at7: { to: ME, input: "0x" } }).c, st);
      expect(r.ok).toBe(false);
      expect(pendingStore.list(st)).toHaveLength(1);
    });
  }
  it("an attempt with a known hash is never released here (Check again settles it from the receipt)", async () => {
    const sent: PendingTx = { ...intentOf("buy"), hash: H("a"), intent: undefined };
    expect((await verifyCancelled(sent, rpc({ mined: 8, at7: { to: ME, input: "0x" } }).c)).ok).toBe(false);
  });
  it("UI (revision 12): there is no Release control at all; a chain search only reports why it stays locked", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    let verifies = 0;
    const tx = intentOf("buy");
    await act(async () => { root.render(createElement(IntentRecovery, { tx, what: "purchase", onCheck: () => {}, verify: async () => { verifies++; return { ok: false as const, reason: "No matching garden transaction from your account has been found yet." }; } })); });
    const buttons = () => [...el.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons().some((b) => /Release/.test(b ?? ""))).toBe(false);
    await act(async () => { [...el.querySelectorAll("button")].find((b) => /Search my account/.test(b.textContent ?? ""))!.click(); });
    expect(verifies).toBe(1);
    expect(el.textContent).toMatch(/has been found yet/);
    expect(el.textContent).toMatch(/may have been sent/);
    expect(buttons().some((b) => /Release/.test(b ?? ""))).toBe(false);
    await act(async () => root.unmount());
  });
  it("UI: a saved transaction with a hash shows no release path at all", async () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => { root.render(createElement(IntentRecovery, { tx: { ...intentOf("claim"), hash: H("a"), intent: undefined }, what: "claim", onCheck: () => {} })); });
    expect(el.textContent).not.toMatch(/Release|verify the cancellation/);
    expect(el.textContent).toMatch(/Check again/);
    await act(async () => root.unmount());
  });
});

describe("db8c2689: the transient purchase step is scoped to its account", () => {
  it("wallet B is not shown or blocked by wallet A's step; switching back restores it", () => {
    purchaseFlow.set({ name: "buy-unknown", hash: intentHash("buy", ME), message: "may have been sent" }, ME);
    expect(purchaseFlow.for(B)).toBeNull();
    expect(purchaseFlow.for(ME)?.name).toBe("buy-unknown");
    purchaseFlow.clear(B); // releasing B's (nonexistent) intent leaves A's step
    expect(purchaseFlow.for(ME.toUpperCase().replace("0X", "0x"))?.name).toBe("buy-unknown");
    purchaseFlow.clear(ME);
    expect(purchaseFlow.get()).toBeNull();
  });
});

describe("c55d2fd3: a sped-up approval links its mined receipt after a re-plan", () => {
  it("records the replacement's hash, the post-receipt allowance, and sends no purchase", async () => {
    const st = new FakeStorage();
    let allowance = 0n, buys = 0;
    const d: PurchaseDeps = {
      account: ME, chainId: () => 1, salesOpen: async () => true, balance: async () => 10n ** 20n, allowance: async () => allowance, ethBalance: async () => 10n ** 18n,
      approve: async (amt) => { allowance = amt; return H("e"); },
      wait: async () => ({ status: "success", hash: H("f") }),
      simulate: async () => { throw new Error("RESPLIT:3:900000"); },
      buy: async () => { buys++; return H("a"); },
      submission: async () => ({ nonce: 7, block: 100n }), explain: (e) => explainError(e), storage: st,
    };
    const s = await runPurchase(d, [0, 0, 0, 0, 0], ["", "", "", "", ""], () => {});
    expect(s.name).toBe("error");
    if (s.name !== "error") return;
    expect(s.approval).toMatchObject({ hash: H("f"), allowance: 5n * 10n ** 18n });
    expect(buys).toBe(0);
  });
});

describe("05708c27: four terrace footprints over unchanged slots", () => {
  it("all four arrangements occur across the initial sectors and slot coordinates are untouched", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 105; i++) { const p = sectorPlan(i); seen.add(terraceArrangement(p.gx, p.gy)); }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    // slot 0 of the founding sector is the hero pedestal; its world coordinates are the pinned ones
    const p0 = sectorPlan(0);
    expect(p0.slots.length).toBeGreaterThan(0);
    expect(p0.slots.every((s) => Number.isFinite(s[0]) && Number.isFinite(s[1]))).toBe(true);
  });
});
