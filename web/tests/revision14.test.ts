// @vitest-environment jsdom
/**
 * Revision 14 regression tests. MOCKED: labelled in-memory storage shared by simulated tabs, a mocked wallet
 * (wagmi actions), mocked RPC reads and mocked receipts. Nothing here talks to a chain or a wallet; no funds are used.
 * One block per reviewer finding:
 *  - 45488fbe: a claim with a known hash stays locked after another tab settles it
 *  - 4307f4bf: a stale hash update overwrites another tab's completed Match
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, type Hash } from "viem";

const ME = "0x00000000000000000000000000000000000000a1";
const H = (c: string) => (`0x${c.repeat(64)}`.slice(0, 66)) as Hash;
const CLAIM_HASH = H("c");
function deferred<T>() { let res!: (v: T) => void, rej!: (e: unknown) => void; const p = new Promise<T>((a, b) => { res = a; rej = b; }); return { p, res, rej }; }

// ---- mocked wallet and RPC for the rendered Rewards panel (tab A) ----
const wallet = vi.hoisted(() => ({
  sends: 0,
  nextHash: "" as string,
  receipt: null as null | { p: Promise<unknown> },
  invalidations: 0,
  settleOk: true,
}));
vi.mock("wagmi", async (orig) => ({ ...(await orig<typeof import("wagmi")>()), useAccount: () => ({ address: "0x00000000000000000000000000000000000000a1", chainId: 1 }) }));
vi.mock("wagmi/actions", async (orig) => ({
  ...(await orig<typeof import("wagmi/actions")>()),
  getAccount: () => ({ address: "0x00000000000000000000000000000000000000a1", chainId: 1, connector: undefined }),
  watchAccount: () => () => {},
  simulateContract: async () => ({ request: { functionName: "claimRewards" } }),
  writeContract: vi.fn(async () => { wallet.sends++; return wallet.nextHash; }),
  // tab A's receipt RPC keeps answering "not yet": its wait never settles until the test releases it
  waitForTransactionReceipt: () => (wallet.receipt ? wallet.receipt.p : new Promise(() => {})),
}));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: () => { wallet.invalidations++; } }),
}));
vi.mock("../src/hooks", async (orig) => ({
  ...(await orig<typeof import("../src/hooks")>()),
  // 2 IMD claimable (mocked reward read)
  useRewards: () => ({ data: { candles: 3n, earned: 2n * 10n ** 18n, claimed: 0n, claimable: 2n * 10n ** 18n }, isLoading: false, isError: false, refetch: () => {} }),
}));
vi.mock("../src/lib/chain", async (orig) => {
  const real = await orig<typeof import("../src/lib/chain")>();
  return {
    ...real,
    submissionMeta: async () => ({ nonce: 9, block: 100n }),
    // getTransaction reports the sent claim's real nonce 9
    sentTx: async () => ({ from: "0x00000000000000000000000000000000000000a1", nonce: 9 }),
    minedTx: async () => ({ from: "0x00000000000000000000000000000000000000a1", to: null, input: "0x", nonce: 9 }),
    // tab B's RPC: a successful receipt for the sent hash, block 100
    settleReceipt: async (hash: Hash) => ({ receipt: { transactionHash: hash, status: "success", blockNumber: 100n, logs: [] }, mined: null }),
  };
});
vi.mock("../src/lib/receipt", async (orig) => ({
  ...(await orig<typeof import("../src/lib/receipt")>()),
  // the garden RewardsClaimed event for 2 IMD (decoding itself is covered by receipt.test.ts)
  settleClaim: () => (wallet.settleOk ? { ok: true, amount: 2n * 10n ** 18n } : { ok: false, message: "not claimed" }),
}));

import { RewardsPanel, checkClaim } from "../src/panels/Panels";
import {
  attemptOf, browserLock, buyIntentHash, inPageLock, pendingStore, purchaseFlow, reconcileSent, setAttemptLock,
  storedEntries, SETTLED_ELSEWHERE_MESSAGE, type PendingTx,
} from "../src/lib/purchase";
import { CLAIM_SETTLED_ELSEWHERE, claimStepApplies, type ClaimStep } from "../src/lib/claim";
import { attachHash } from "../src/lib/chain";
import { GARDEN } from "../src/config";
import { wishGardenAbi } from "../src/abi/WishGarden";

/** Labelled fixture storage shared by two simulated tabs (same origin, same localStorage). */
class SharedStorage {
  m = new Map<string, string>();
  onSet: ((k: string, v: string) => void) | null = null;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.onSet?.(k, v); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const asS = (s: SharedStorage) => s as unknown as Storage;
const H1 = H("1");
const H2 = H("2");
const intentA = (): PendingTx => ({ attempt: "A", account: ME, hash: buyIntentHash(ME), kind: "buy", intent: true, nonce: 7, block: "100", createdAt: 1, styles: [1], wishes: ["w"] });
const attach = (h: Hash, nonce: number) => (cur: PendingTx): PendingTx => ({ ...cur, hash: h, intent: undefined, nonce, nonceChecked: true });
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { setAttemptLock(null); localStorage.clear(); });

describe("4307f4bf: compare-and-update is atomic across tabs (shared lock around read, compare and write)", () => {
  it("reviewer's interleaving: tab B's update issued while tab A is paused at its setItem cannot overwrite or be overwritten", async () => {
    const st = new SharedStorage();
    pendingStore.persist(intentA(), asS(st));
    const placeholder = buyIntentHash(ME);
    let pB: Promise<{ result: string; current: PendingTx | null }> | null = null;
    // pause tab A at the setItem of A's attempt key (after its read and comparison) and run tab B's whole update there
    st.onSet = (k, v) => {
      if (pB || !k.includes(":a:A") || !v.includes(H1.slice(2))) return;
      pB = pendingStore.compareAndUpdate("A", attach(H2, 9), asS(st), placeholder);
    };
    const a = await pendingStore.compareAndUpdate("A", attach(H1, 8), asS(st), placeholder);
    expect(pB).not.toBeNull();
    const b = await pB!;
    const savedNow = storedEntries(asS(st))[0];
    // exactly one writer wins; the other fails its comparison and gets the winner's CURRENT entry back, unchanged
    expect([a.result, b.result].sort()).toEqual(["missing", "updated"]);
    const [win, lose] = a.result === "updated" ? [a, b] : [b, a];
    expect(savedNow.hash).toBe(win.current!.hash);
    expect(lose.current!.hash).toBe(savedNow.hash);
    expect(savedNow.nonce).toBe(win.current!.nonce);
  });
  it("tab B's commit first: B updated, A fails its comparison, the saved hash stays H2 (the reviewer's expected end state)", async () => {
    const st = new SharedStorage();
    pendingStore.persist(intentA(), asS(st));
    const placeholder = buyIntentHash(ME);
    const pB = pendingStore.compareAndUpdate("A", attach(H2, 9), asS(st), placeholder);
    const pA = pendingStore.compareAndUpdate("A", attach(H1, 8), asS(st), placeholder);
    const [a, b] = await Promise.all([pA, pB]);
    expect(b.result).toBe("updated");
    expect(a).toMatchObject({ result: "missing", current: { hash: H2, nonce: 9 } });
    expect(storedEntries(asS(st))[0]).toMatchObject({ hash: H2, nonce: 9 });
  });
  it("two Match (attachHash) commits racing in two tabs: one attaches, the other returns the current entry and recovery checks only that", async () => {
    const st = new SharedStorage();
    const intent = intentA();
    pendingStore.persist(intent, asS(st));
    const input = encodeFunctionData({ abi: wishGardenAbi, functionName: "buyCandles", args: [[1], ["w"]] });
    const l1 = deferred<{ hash: Hash; from: string; to: string; input: `0x${string}`; nonce: number; chainId: number }>();
    const l2 = deferred<{ hash: Hash; from: string; to: string; input: `0x${string}`; nonce: number; chainId: number }>();
    const pA = attachHash(intent, H1, { tx: () => l1.p }, asS(st));
    const pB = attachHash(intent, H2, { tx: () => l2.p }, asS(st));
    // both asynchronous lookups complete; A's commit is paused at its write while B's commit is issued
    let issued = false;
    st.onSet = (k, v) => { if (!issued && k.includes(":a:A") && v.includes(H1.slice(2))) { issued = true; l2.res({ hash: H2, from: ME, to: GARDEN, input, nonce: 9, chainId: 1 }); } };
    l1.res({ hash: H1, from: ME, to: GARDEN, input, nonce: 8, chainId: 1 });
    const [a, b] = await Promise.all([pA, pB]);
    expect(issued).toBe(true);
    const savedNow = storedEntries(asS(st))[0];
    const oks = [a, b].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok)!;
    expect(loser).toMatchObject({ settled: true, current: { hash: savedNow.hash } });
    expect(oks[0].ok && oks[0].tx.hash).toBe(savedNow.hash);
  });
  it("replace (the wallet's sent hash) never overwrites a real hash another tab already attached; it returns that entry", async () => {
    const st = new SharedStorage();
    pendingStore.persist(intentA(), asS(st));
    expect((await pendingStore.compareAndUpdate("A", attach(H2, 9), asS(st), buyIntentHash(ME))).result).toBe("updated");
    const r = await pendingStore.replace("A", { ...intentA(), hash: H1, intent: undefined, nonce: 7 }, asS(st));
    expect(r.current).toMatchObject({ hash: H2, nonce: 9 });
    expect(storedEntries(asS(st))[0]).toMatchObject({ hash: H2, nonce: 9 });
  });
  it("metadata reconciliation of a stale hash returns the current entry instead of overwriting it", async () => {
    const st = new SharedStorage();
    const sent: PendingTx = { ...intentA(), hash: H1, intent: undefined, nonceChecked: false };
    pendingStore.persist(sent, asS(st));
    await pendingStore.compareAndUpdate("A", attach(H2, 9), asS(st), H1); // another tab matched H2
    const got = await reconcileSent({ sentTx: async () => ({ from: ME, nonce: 8 }), storage: asS(st) }, sent, 1);
    expect(got).toMatchObject({ hash: H2, nonce: 9 });
    expect(storedEntries(asS(st))[0]).toMatchObject({ hash: H2, nonce: 9 });
  });
  it("in the browser the critical section runs under a Web Lock named after the attempt (navigator.locks, exclusive)", async () => {
    const names: string[] = [];
    let chain = Promise.resolve() as Promise<unknown>;
    const fake = {
      request: (name: string, opts: { mode: string }, cb: () => unknown) => {
        names.push(`${name}|${opts.mode}`);
        const run = chain.then(() => cb());
        chain = run.catch(() => undefined);
        return run;
      },
    };
    Object.defineProperty(navigator, "locks", { value: fake, configurable: true });
    try {
      setAttemptLock(browserLock);
      const st = new SharedStorage();
      pendingStore.persist(intentA(), asS(st));
      await pendingStore.compareAndUpdate("A", attach(H1, 8), asS(st), buyIntentHash(ME));
      expect(names).toEqual(["everlight-attempt-A|exclusive"]);
    } finally {
      delete (navigator as unknown as { locks?: unknown }).locks;
    }
    expect(inPageLock).toBeTypeOf("function");
  });
});

describe("45488fbe: a claim with a known hash is released when another tab settles it", () => {
  it("390-wide tab A: Claim 2 IMD → pending (nonce 9, receipt null); tab B verifies the receipt → A releases its lock, keeps the link, refreshes rewards", async () => {
    const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    g.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    wallet.sends = 0;
    wallet.nextHash = CLAIM_HASH;
    wallet.invalidations = 0;
    const tabAReceipt = deferred<unknown>();
    wallet.receipt = { p: tabAReceipt.p };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(RewardsPanel)); });
    const button = () => host.querySelector("button.cta") as HTMLButtonElement;
    expect(button().textContent).toBe("Claim 2 IMD");
    await act(async () => { button().click(); await tick(); await tick(); });
    expect(wallet.sends).toBe(1);
    expect(host.textContent).toContain("Claim sent. Waiting for its receipt");
    expect(button().disabled).toBe(true);
    expect(button().textContent).toBe("Claiming…");
    const saved = pendingStore.list().filter((t) => t.kind === "claim");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ hash: CLAIM_HASH, nonce: 9, nonceChecked: true });

    // tab B (same storage): automatic recovery verifies the successful receipt and removes the durable attempt
    const before = wallet.invalidations;
    let b!: Awaited<ReturnType<typeof checkClaim>>;
    await act(async () => { b = await checkClaim(saved[0]); await tick(); });
    expect(b.text).toBe("Your earlier claim confirmed: 2 IMD claimed.");
    expect(pendingStore.list().filter((t) => t.kind === "claim")).toHaveLength(0);

    // tab A: released (enabled Claim), the transaction link kept, rewards re-read
    expect(host.textContent).not.toContain("Claim sent. Waiting for its receipt");
    expect(host.textContent).toContain(CLAIM_SETTLED_ELSEWHERE);
    expect(host.querySelector(`a[href$="/tx/${CLAIM_HASH}"]`)).not.toBeNull();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toBe("Claim 2 IMD");
    expect(wallet.invalidations).toBeGreaterThan(before);

    // the released lock lets a NEW claim start at once (in-flight lock released for that attempt only)
    const newer = deferred<string>();
    wallet.nextHash = H("d");
    const { writeContract } = await import("wagmi/actions");
    const spy = vi.mocked(writeContract);
    const orig = spy.getMockImplementation();
    spy.mockImplementationOnce(async () => { wallet.sends++; return newer.p as Promise<never>; });
    await act(async () => { button().click(); await tick(); await tick(); });
    expect(wallet.sends).toBe(2);
    expect(button().textContent).toBe("Confirm in your wallet…");

    // tab A's old wait finally fails (receipt RPC times out): it must not overwrite the newer attempt's step
    await act(async () => { tabAReceipt.rej(new Error("timeout")); await tick(); await tick(); });
    expect(button().textContent).toBe("Confirm in your wallet…");
    expect(host.textContent).not.toContain("may have been sent, but its receipt could not be read");
    if (orig) spy.mockImplementation(orig);
    await act(async () => { root.unmount(); });
    host.remove();
    wallet.receipt = null;
  });
  it("claimStepApplies: a released attempt cannot re-lock Claim, its own final outcome still shows, a newer attempt is never overwritten", () => {
    const released = new Set(["X"]);
    const resolved: ClaimStep = { s: "resolved", msg: "m", attempt: "X" };
    expect(claimStepApplies(resolved, { s: "uncertain", msg: "u", attempt: "X" }, released)).toBe(false);
    expect(claimStepApplies(resolved, { s: "done", hash: H("e"), amount: 1n, attempt: "X" }, released)).toBe(true);
    expect(claimStepApplies({ s: "wallet", attempt: "Y" }, { s: "error", msg: "late", attempt: "X" }, released)).toBe(false);
    expect(claimStepApplies({ s: "pending", hash: H("f"), attempt: "Y" }, { s: "pending", hash: H("f"), attempt: "Y" }, released)).toBe(true);
  });
});

describe("45488fbe (purchases, same rule): a buy-pending step is released when its attempt settles elsewhere", () => {
  it("tab A waits on a known purchase hash; tab B settles it → A shows the link, releases the lock, ignores its delayed running step", () => {
    const tx: PendingTx = { attempt: "P", account: ME, hash: H("7"), kind: "buy", createdAt: 1, nonce: 9, nonceChecked: true, block: "100", styles: [1], wishes: ["w"] };
    pendingStore.persist(tx);
    const releasedFor: string[] = [];
    const off = purchaseFlow.onRelease((a, at) => releasedFor.push(`${a}:${at}`));
    purchaseFlow.set({ name: "buy-pending", hash: tx.hash }, ME, "P");
    pendingStore.removeAttempt("P"); // tab B's verified receipt settles it
    expect(purchaseFlow.get()).toMatchObject({ name: "error", message: SETTLED_ELSEWHERE_MESSAGE, hash: tx.hash });
    expect(releasedFor).toEqual([`${ME}:P`]);
    expect(purchaseFlow.report("P", { name: "buy-unknown", hash: tx.hash, message: "late" }, ME)).toBe(false);
    expect(purchaseFlow.report("P", { name: "done", hash: tx.hash, firstId: 1, quantity: 1 }, ME)).toBe(true);
    off();
    purchaseFlow.set(null);
    expect(attemptOf(tx)).toBe("P");
  });
});
