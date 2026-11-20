// @vitest-environment jsdom
/**
 * Revision 12 regression tests (MOCKED: labelled in-memory storage, mock wallets and mock RPC clients; nothing here
 * talks to a chain or a wallet). One block per transaction finding of the brief.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Hash } from "viem";

vi.mock("../src/lib/chain", async (orig) => {
  const real = await orig<typeof import("../src/lib/chain")>();
  return {
    ...real,
    // the pasted hash is "found on Ethereum" and matches: the real hash is attached to the same attempt
    attachHash: async (tx: import("../src/lib/purchase").PendingTx, h: string) => {
      const next = { ...tx, attempt: real.savedAttempt(tx)?.attempt ?? tx.attempt, hash: h as Hash, intent: undefined, nonce: 9, nonceChecked: true };
      const { pendingStore, attemptOf } = await import("../src/lib/purchase");
      await pendingStore.replace(attemptOf(tx), next);
      return { ok: true, tx: next };
    },
  };
});

import {
  AMBIGUOUS_MESSAGE, DUPLICATE_MESSAGE, PENDING_STORAGE_KEY, SENT_UNKNOWN_MESSAGE, WALLET_CHANGED_MESSAGE,
  attemptOf, awaitBuy, storedEntries, buyIntentHash, latestAllowance, pendingStore, purchaseFlow, runPurchase,
  type PendingTx, type PurchaseDeps, type Receipt, type Step,
} from "../src/lib/purchase";
import { resolveIntent, intentHash, type IntentClient } from "../src/lib/intent";
import { releaseVerified, verifyCancelled } from "../src/lib/chain";
import { runClaim } from "../src/lib/claim";
import { IntentRecovery } from "../src/panels/LightPanel";
import { GARDEN } from "../src/config";
import { encodeFunctionData } from "viem";
import { wishGardenAbi } from "../src/abi/WishGarden";

/** Labelled fixture storage shared by two simulated tabs (same origin, same localStorage). */
class SharedStorage {
  m = new Map<string, string>();
  failSet: ((k: string, v: string) => boolean) | null = null;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.failSet?.(k, v)) throw new Error("QuotaExceededError"); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const asS = (s: SharedStorage) => s as unknown as Storage;
const saved = (s: SharedStorage): PendingTx[] => storedEntries(asS(s));
/** Another tab settling every saved attempt by writing storage directly (each attempt's own key). */
const otherTabSettlesAll = (s: SharedStorage) => { for (const k of [...s.m.keys()]) if (k.startsWith(`${PENDING_STORAGE_KEY}:a:`)) s.m.delete(k); };
const ME = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const H = (c: string) => (`0x${c.repeat(64)}`.slice(0, 66)) as Hash;
const err = (code: number, message: string) => Object.assign(new Error(message), { code });
function deferred<T>() { let res!: (v: T) => void, rej!: (e: unknown) => void; const p = new Promise<T>((a, b) => { res = a; rej = b; }); return { p, res, rej }; }

const okReceipt = (hash: Hash, styles: number[], wishes: string[], firstId = 1): Receipt => ({
  status: "success", hash,
  purchase: { purchaser: ME, firstId, quantity: styles.length },
  created: styles.map((st, i) => ({ id: firstId + i, purchaser: ME, style: st, wish: wishes[i] })),
  from: ME, to: GARDEN, call: { styles, wishes },
});

let seq = 0;
function deps(st: SharedStorage, over: Partial<PurchaseDeps> = {}): PurchaseDeps {
  return {
    account: ME, chainId: () => 1, salesOpen: async () => true,
    balance: async () => 10n ** 20n, allowance: async () => 10n ** 20n, ethBalance: async () => 10n ** 18n,
    approve: async () => H("a"),
    wait: async (h) => okReceipt(h, [1], ["w"]),
    simulate: async () => ({ req: true }),
    buy: async () => H("b"),
    submission: async () => ({ nonce: 7, block: 100n }),
    walletState: async () => ({ account: ME, chainId: 1 }),
    explain: (e) => (e instanceof Error ? e.message : String(e)),
    storage: asS(st),
    newAttempt: () => `attempt-${++seq}`,
    ...over,
  };
}

/** Mock RPC for nonce searches: `txAt` maps nonce -> transaction that consumed it. */
function rpc(o: { mined: number; pending?: number; txAt: Record<number, { hash: Hash; to: string; input: `0x${string}`; from?: string }> }): IntentClient {
  return {
    receipt: async () => null,
    nonceAt: async (_a, block) => (block === undefined ? o.mined : block >= 105n ? o.mined : 7),
    head: async () => 110n,
    blockTxs: async (b) => Object.entries(o.txAt).filter(() => b === 105n).map(([n, t]) => ({ hash: t.hash, from: t.from ?? ME, nonce: Number(n) })),
    pendingNonce: async () => o.pending ?? o.mined,
    tx: async (h) => { const e = Object.entries(o.txAt).find(([, t]) => t.hash === h); return e ? { hash: h, from: e[1].from ?? ME, to: e[1].to, input: e[1].input, nonce: Number(e[0]), chainId: 1 } : null; },
  };
}
const buyInput = (styles: number[], wishes: string[]) => encodeFunctionData({ abi: wishGardenAbi, functionName: "buyCandles", args: [styles, wishes] as never });

describe("1. unknown-hash recovery: the preflight nonce is not the broadcast nonce", () => {
  it("wallet broadcasts at a higher nonce (9) then returns 4900: the attempt stays uncertain; an unrelated tx at nonce 7 never proves cancellation", async () => {
    const st = new SharedStorage();
    const s = await runPurchase(deps(st, { buy: async () => { throw err(4900, "Disconnected"); } }), [2], ["kept wish"], () => {});
    expect(s.name).toBe("buy-unknown");
    expect((s as { message: string }).message).toBe(AMBIGUOUS_MESSAGE);
    expect((s as { message: string }).message).toMatch(/may have been sent/);
    const intent = saved(st)[0];
    expect(intent.intent).toBe(true);
    expect(intent.nonce).toBe(7);
    // nonce 7 consumed by an unrelated self-send, the real purchase not yet visible (private relay): mined 8, nothing pending
    const c = rpc({ mined: 8, txAt: { 7: { hash: H("7"), to: ME, input: "0x" } } });
    expect((await resolveIntent(c, intent)).kind).toBe("not-found");
    const v = await verifyCancelled(intent, c);
    expect(v.ok).toBe(false);
    const r = await releaseVerified(intent, (t) => pendingStore.removeAttempt(attemptOf(t), asS(st)), c, asS(st));
    expect(r.ok).toBe(false);
    expect(saved(st)).toHaveLength(1);
    // duplicate-send protection holds: a second purchase is refused without reaching the wallet
    let asked = 0;
    const again = await runPurchase(deps(st, { buy: async () => { asked++; return H("c"); } }), [2], ["kept wish"], () => {});
    expect(again).toMatchObject({ name: "error", message: DUPLICATE_MESSAGE });
    expect(asked).toBe(0);
    // evidence tied to the submitted transaction: the matching call is found at nonce 9 once it is mined
    const c2 = rpc({ mined: 10, txAt: { 7: { hash: H("7"), to: ME, input: "0x" }, 8: { hash: H("8"), to: ME, input: "0x" }, 9: { hash: H("9"), to: GARDEN, input: buyInput([2], ["kept wish"]) } } });
    const found = await resolveIntent({ ...c2, nonceAt: async (_a, b) => (b === undefined ? 10 : 10), blockTxs: async () => [{ hash: H("7"), from: ME, nonce: 7 }, { hash: H("8"), from: ME, nonce: 8 }, { hash: H("9"), from: ME, nonce: 9 }] }, intent);
    expect(found).toEqual({ kind: "found", hash: H("9") });
  });
  it("claims: a 4900 after possible broadcast keeps the claim intent; nonce evidence never releases it", async () => {
    const st = new SharedStorage();
    const s = await runClaim({ account: ME, storage: asS(st), simulate: async () => ({}), submission: async () => ({ nonce: 7, block: 100n }), send: async () => { throw err(4900, "Disconnected"); }, wait: async () => ({ ok: true, hash: H("c") }), explain: () => "x", walletState: async () => ({ account: ME, chainId: 1 }), newAttempt: () => "claim-1" }, () => {});
    expect(s.s).toBe("uncertain");
    const intent = saved(st)[0];
    expect((await verifyCancelled(intent, rpc({ mined: 8, txAt: { 7: { hash: H("7"), to: ME, input: "0x" } } }))).ok).toBe(false);
    expect(saved(st)).toHaveLength(1);
  });
});

describe("2. durable attempt ids: old callbacks only touch their own attempt (two tabs)", () => {
  it("tab A's delayed receipt, arriving after tab B started a new uncertain purchase, removes only A's attempt", async () => {
    const st = new SharedStorage();
    const receiptA = deferred<Receipt>();
    const stepsA: [Step, string][] = [];
    // tab A sends and waits on a slow receipt
    const runA = runPurchase(deps(st, { buy: async () => H("a1"), wait: () => receiptA.p, newAttempt: () => "A" }), [1], ["a"], (s, id) => stepsA.push([s, id]));
    await vi.waitFor(() => expect(saved(st).map((t) => t.hash)).toEqual([H("a1")]));
    // tab B: the user matched/settled A there (A's attempt removed), then started a new purchase that became uncertain
    pendingStore.removeAttempt("A", asS(st));
    const b = await runPurchase(deps(st, { buy: async () => { throw err(4900, "Disconnected"); }, newAttempt: () => "B" }), [3], ["b"], () => {});
    expect(b.name).toBe("buy-unknown");
    expect(saved(st).map(attemptOf)).toEqual(["B"]);
    // tab A's receipt finally arrives
    receiptA.res(okReceipt(H("a1"), [1], ["a"]));
    const a = await runA;
    expect(a.name).toBe("done");
    expect(stepsA.every(([, id]) => id === "A")).toBe(true);
    // B's uncertain intent (same placeholder hash as any intent of this account) is untouched
    expect(saved(st)).toHaveLength(1);
    expect(saved(st)[0]).toMatchObject({ attempt: "B", hash: buyIntentHash(ME), intent: true });
  });
  it("a delayed rejection of an old attempt never removes a newer attempt with the same placeholder hash", () => {
    const st = new SharedStorage();
    const base = { hash: intentHash("buy", ME), kind: "buy" as const, intent: true, account: ME, createdAt: 1 };
    pendingStore.persist({ ...base, attempt: "new" }, asS(st));
    pendingStore.removeAttempt("old", asS(st));
    pendingStore.remove(intentHash("buy", ME), asS(st)); // a hash-based removal never touches intents
    expect(saved(st).map(attemptOf)).toEqual(["new"]);
  });
  it("purchaseFlow: a stale attempt's step never overwrites a newer running/uncertain attempt", () => {
    purchaseFlow.set({ name: "buy-unknown", hash: H("0"), message: "m" }, ME, "B");
    expect(purchaseFlow.report("A", { name: "done", hash: H("a"), firstId: 1 }, ME)).toBe(false);
    expect(purchaseFlow.get()?.name).toBe("buy-unknown");
    expect(purchaseFlow.report("B", { name: "done", hash: H("b"), firstId: 2 }, ME)).toBe(true);
    purchaseFlow.set(null);
  });
  it("compare-and-update: a nonce reconciliation never resurrects an attempt another tab settled", async () => {
    const st = new SharedStorage();
    pendingStore.persist({ hash: H("a"), kind: "buy", account: ME, createdAt: 1, attempt: "A" }, asS(st));
    pendingStore.removeAttempt("A", asS(st));
    expect(await pendingStore.update("A", (t) => ({ ...t, nonce: 9, nonceChecked: true }), asS(st), H("a"))).toBe("missing");
    expect(saved(st)).toHaveLength(0);
  });
});

describe("3. every wallet request is bound to the initiating account and chain", () => {
  it("account switched during the async checks: no approval request, nothing sent, fresh click needed", async () => {
    const st = new SharedStorage();
    let approves = 0, buys = 0;
    const s = await runPurchase(deps(st, { allowance: async () => 0n, approve: async () => { approves++; return H("a"); }, buy: async () => { buys++; return H("b"); }, walletState: async () => ({ account: OTHER, chainId: 1 }) }), [1], ["w"], () => {});
    expect(s).toMatchObject({ name: "error", message: WALLET_CHANGED_MESSAGE });
    expect(approves + buys).toBe(0);
    expect(saved(st)).toHaveLength(0);
  });
  it("network switched after the approval confirmed (mid-request): the purchase is not sent and its intent is withdrawn", async () => {
    const st = new SharedStorage();
    let reads = 0, buys = 0;
    const s = await runPurchase(deps(st, {
      allowance: async () => (reads++ === 0 ? 0n : 10n ** 18n),
      walletState: async () => ({ account: ME, chainId: reads > 1 ? 8453 : 1 }),
      buy: async () => { buys++; return H("b"); },
    }), [1], ["w"], () => {});
    expect(s.name).toBe("error");
    expect((s as { message: string }).message).toMatch(/account or network changed/);
    expect(buys).toBe(0);
    expect(saved(st)).toHaveLength(0);
  });
  it("claims re-read the wallet immediately before sending", async () => {
    const st = new SharedStorage();
    let sends = 0;
    const s = await runClaim({ account: ME, storage: asS(st), simulate: async () => ({}), submission: async () => ({ nonce: 1, block: 1n }), send: async () => { sends++; return H("c"); }, wait: async () => ({ ok: true, hash: H("c") }), explain: () => "x", walletState: async () => ({ account: OTHER, chainId: 1 }) }, () => {});
    expect(s).toMatchObject({ s: "error", msg: WALLET_CHANGED_MESSAGE });
    expect(sends).toBe(0);
    expect(saved(st)).toHaveLength(0);
  });
});

describe("4. successfully persisted storage is authoritative", () => {
  it("an entry settled in another tab is not merged back from this tab's memory", () => {
    const st = new SharedStorage();
    pendingStore.add({ hash: H("a"), kind: "approve", account: ME, createdAt: 1, attempt: "ap" }, asS(st));
    // other tab settles it: writes storage directly
    otherTabSettlesAll(st);
    expect(pendingStore.list(asS(st))).toHaveLength(0);
  });
  it("memory fallback only for a failed save; it still blocks a duplicate send", async () => {
    const st = new SharedStorage();
    st.failSet = () => true;
    expect(pendingStore.add({ hash: H("b"), kind: "buy", account: ME, createdAt: 1, attempt: "m" }, asS(st))).toBe(false);
    expect(pendingStore.list(asS(st)).map(attemptOf)).toEqual(["m"]);
    st.failSet = null;
    let asked = 0;
    const s = await runPurchase(deps(st, { buy: async () => { asked++; return H("c"); } }), [1], ["w"], () => {});
    expect(s).toMatchObject({ name: "error", message: DUPLICATE_MESSAGE });
    expect(asked).toBe(0);
    pendingStore.removeAttempt("m", asS(st));
    expect(pendingStore.list(asS(st))).toHaveLength(0);
  });
  it("an overlay (sent hash that could not replace its saved intent) is dropped once another tab settles the attempt", async () => {
    const st = new SharedStorage();
    st.failSet = (_k, v) => v.includes(H("d").slice(2, 10)) && v.includes(`"${H("d")}"`);
    const s = await runPurchase(deps(st, { buy: async () => H("d"), wait: async () => { throw new Error("rpc down"); }, newAttempt: () => "O" }), [1], ["w"], () => {});
    expect(s.name).toBe("buy-unknown");
    expect(pendingStore.list(asS(st)).map((t) => t.hash)).toEqual([H("d")]); // this page locks on the real hash
    st.failSet = null;
    otherTabSettlesAll(st); // another tab matched and settled it
    expect(pendingStore.list(asS(st))).toHaveLength(0);
  });
});

describe("5. after Match the returned transaction and its real hash are checked at once", () => {
  it("IntentRecovery passes the matched entry (real hash) to the check, not the stale placeholder", async () => {
    const st = localStorage;
    st.clear();
    const intent: PendingTx = { hash: intentHash("buy", ME), kind: "buy", intent: true, account: ME, createdAt: 5, nonce: 7, block: "100", from: ME, styles: [1], wishes: ["w"], attempt: "M" };
    pendingStore.persist(intent);
    const checked: (PendingTx | undefined)[] = [];
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(createElement(IntentRecovery, { tx: intent, what: "purchase", onCheck: async (t?: PendingTx) => { checked.push(t); } })); });
    const input = el.querySelector("input")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, H("e")); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(checked).toHaveLength(1);
    expect(checked[0]?.hash).toBe(H("e"));
    expect(checked[0]?.intent).toBeUndefined();
    expect(pendingStore.get("M")?.hash).toBe(H("e"));
    await act(async () => root.unmount());
    st.clear();
  });
  it("a mined receipt settles in one action; unknown outcomes say 'may have been sent'", async () => {
    const st = new SharedStorage();
    const tx: PendingTx = { hash: H("f"), kind: "buy", account: ME, createdAt: 1, styles: [4], wishes: ["x"], quantity: 1, attempt: "S" };
    pendingStore.persist(tx, asS(st));
    const s = await awaitBuy({ wait: async (h) => okReceipt(h, [4], ["x"], 40), explain: () => "", storage: asS(st) }, tx, () => {});
    expect(s).toMatchObject({ name: "done", firstId: 40 });
    expect(saved(st)).toHaveLength(0);
    expect(SENT_UNKNOWN_MESSAGE).toMatch(/may have been sent/);
    expect(SENT_UNKNOWN_MESSAGE).not.toMatch(/confirmed|lit/);
  });
});

describe("6. the latest verified allowance, never the max", () => {
  it("a newer read after revocation beats an older, larger approval", () => {
    expect(latestAllowance({ allowance: 0n, at: 200 }, { allowance: 5n, at: 100 })).toBe(0n);
    expect(latestAllowance({ allowance: 2n, at: 100 }, { allowance: 5n, at: 200 })).toBe(5n);
    expect(latestAllowance({ allowance: 9n, at: 300 }, { allowance: 5n, at: 200 })).toBe(9n);
    expect(latestAllowance(null, null)).toBeUndefined();
  });
  it("after a reduction the purchase explicitly requests a fresh exact approval", async () => {
    const st = new SharedStorage();
    const steps: Step[] = [];
    let approved: bigint | null = null;
    let reads = 0;
    const s = await runPurchase(deps(st, { allowance: async () => (reads++ === 0 ? 1n * 10n ** 18n : 3n * 10n ** 18n), approve: async (a) => { approved = a; return H("a"); }, wait: async (h) => okReceipt(h, [1, 2, 3], ["a", "b", "c"]) }), [1, 2, 3], ["a", "b", "c"], (x) => steps.push(x));
    expect(approved).toBe(3n * 10n ** 18n);
    expect(steps.some((x) => x.name === "approve-wallet")).toBe(true);
    expect(s.name).toBe("done");
  });
});
