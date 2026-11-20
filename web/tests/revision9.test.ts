// Regression tests for the final review's four findings (job 9ec2492e follow-up).
// LABELLED MOCKS ONLY: in-memory storage, mock wallet and mock chain reads. No wallet, fork or live chain; nothing is sent.
import { beforeEach, describe, expect, it } from "vitest";
import { encodeFunctionData, type Hash } from "viem";
import { wishGardenAbi } from "../src/abi/WishGarden";
import { GARDEN } from "../src/config";
import { AMBIGUOUS_MESSAGE, APPROVED_NOT_SENT, DUPLICATE_MESSAGE, INTENT_HASH, pendingStore, removeBuyIntent, runPurchase, type PendingTx, type PurchaseDeps, type Step } from "../src/lib/purchase";
import { intentHash, isProvenRejection, matchesIntent, resolveIntent, type IntentClient, type SeenTx } from "../src/lib/intent";
import { attachHash } from "../src/lib/chain";
import { CLAIM_BUSY_MESSAGE, CLAIM_STORAGE_MESSAGE, runClaim, type ClaimDeps, type ClaimStep } from "../src/lib/claim";
import { explainError } from "../src/lib/errors";
import { CandleStore, type Candle, type CandleSource } from "../src/lib/candles";
import { countLine } from "../src/lib/counts";

const ME = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const H = (c: string) => `0x${c.repeat(64)}` as Hash;

/** localStorage stand-in. Two instances over one Map behave like two tabs of the same origin. */
class FakeStorage implements Storage {
  failWrites = false;
  failAfter = Infinity;
  writes = 0;
  constructor(public map = new Map<string, string>()) {}
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) {
    this.writes++;
    if (this.failWrites || this.writes > this.failAfter) throw new DOMException("QuotaExceededError", "QuotaExceededError");
    this.map.set(k, v);
  }
}
const saved = (s: Storage) => pendingStore.list(new FakeStorage((s as FakeStorage).map));

const providerError = (code: number, message: string) => Object.assign(new Error(message), { code });

const baseDeps = (storage: Storage, over: Partial<PurchaseDeps> = {}): PurchaseDeps => ({
  account: ME, chainId: () => 1, salesOpen: async () => true,
  balance: async () => 10n ** 20n, allowance: async () => 10n ** 20n, ethBalance: async () => 10n ** 18n,
  approve: async () => H("e"), wait: async () => ({ status: "success" }),
  simulate: async () => ({ request: true }), buy: async () => H("a"),
  submission: async () => ({ nonce: 7, block: 100n }), explain: (e) => explainError(e), storage, ...over,
});

describe("finding 1: an ambiguous wallet failure keeps a durable purchase intent", () => {
  it("broadcast-then-4900: the intent survives, the draft stays locked and a reload cannot buy again", async () => {
    const map = new Map<string, string>();
    const tab = new FakeStorage(map);
    let asked = 0;
    const steps: Step[] = [];
    const s = await runPurchase(baseDeps(tab, { buy: async () => { asked++; throw providerError(4900, "The provider is disconnected from all chains."); } }), [1], ["hi"], (x) => steps.push(x));
    expect(s.name).toBe("buy-unknown");
    expect(s.name === "buy-unknown" && s.message).toBe(AMBIGUOUS_MESSAGE);
    // reload: a fresh storage object over the same origin data
    const reload = new FakeStorage(map);
    const list = pendingStore.list(reload);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ hash: intentHash("buy", ME), intent: true, kind: "buy", account: ME, nonce: 7, block: "100", styles: [1], wishes: ["hi"] });
    // reconnect and try again: no second wallet request
    const again = await runPurchase(baseDeps(reload, { buy: async () => { asked++; return H("b"); } }), [1], ["hi"], () => {});
    expect(again).toMatchObject({ name: "error", message: DUPLICATE_MESSAGE });
    expect(asked).toBe(1);
  });

  it("a timeout is ambiguous; only a 4001 rejection releases the intent", async () => {
    const t = new FakeStorage();
    const timeout = await runPurchase(baseDeps(t, { buy: async () => { throw new Error("Request timed out"); } }), [0], [""], () => {});
    expect(timeout.name).toBe("buy-unknown");
    expect(saved(t).some((x) => x.intent)).toBe(true);
    const r = new FakeStorage();
    const rejected = await runPurchase(baseDeps(r, { buy: async () => { throw providerError(4001, "User rejected the request."); } }), [0], [""], () => {});
    expect(rejected.name).toBe("error");
    expect(saved(r)).toHaveLength(0);
    expect(isProvenRejection(providerError(4900, "disconnected"))).toBe(false);
    expect(isProvenRejection(providerError(4901, "chain disconnected"))).toBe(false);
    expect(isProvenRejection({ name: "X", cause: { code: 4001 } })).toBe(true);
  });

  const intent: PendingTx = { hash: INTENT_HASH, kind: "buy", intent: true, account: ME, from: ME, nonce: 7, block: "100", createdAt: 0, styles: [2, 3], wishes: ["a", "b"] };
  const buyInput = (styles: number[], wishes: string[]) => encodeFunctionData({ abi: wishGardenAbi, functionName: "buyCandles", args: [styles, wishes] as never });
  const tx = (hash: Hash, nonce: number, over: Partial<SeenTx> = {}): SeenTx => ({ hash, from: ME, to: GARDEN, input: buyInput([2, 3], ["a", "b"]), nonce, chainId: 1, ...over });

  function client(byNonce: Record<number, SeenTx>, mined: number, pending = mined): IntentClient {
    const blockOf = (n: number) => 100n + BigInt(n - 6); // nonce n mined at block 101 + (n - 7)
    return {
      receipt: async () => null,
      nonceAt: async (_a, b) => (b === undefined ? mined : Math.min(mined, 7 + Math.max(0, Number(b - 100n)))),
      pendingNonce: async () => pending,
      head: async () => 120n,
      blockTxs: async (b) => Object.values(byNonce).filter((t) => blockOf(t.nonce) === b).map((t) => ({ hash: t.hash, from: t.from, nonce: t.nonce })),
      tx: async (h) => Object.values(byNonce).find((t) => t.hash === h) ?? null,
    };
  }

  it("resolves by account, chain, target, nonce and exact calldata (also when the wallet used a later nonce)", async () => {
    expect(await resolveIntent(client({}, 7), intent)).toEqual({ kind: "pending" });
    expect(await resolveIntent(client({ 7: tx(H("a"), 7) }, 8), intent)).toEqual({ kind: "found", hash: H("a") });
    const other = tx(H("c"), 7, { to: ME, input: "0x" });
    expect(await resolveIntent(client({ 7: other, 8: tx(H("d"), 8) }, 9), intent)).toEqual({ kind: "found", hash: H("d") });
    // nonce used by something else, and something is still pending: not proof nothing was sent
    expect(await resolveIntent(client({ 7: other }, 8, 9), intent)).toEqual({ kind: "pending" });
    // everything since accounted for and nothing pending: the user may confirm the release
    expect(await resolveIntent(client({ 7: other }, 8, 8), intent)).toEqual({ kind: "not-found", checked: 1 });
    // a purchase with different wishes is not this draft
    const diff = tx(H("f"), 7, { input: buyInput([2, 3], ["a", "X"]) });
    expect((await resolveIntent(client({ 7: diff }, 8), intent)).kind).toBe("not-found");
  });

  it("transaction-hash reconciliation validates before replacing the intent", async () => {
    const st = new FakeStorage();
    pendingStore.persist(intent, st);
    const c = (t: SeenTx | null) => ({ tx: async () => t });
    expect(await attachHash(intent, "0x1234", c(null), st)).toMatchObject({ ok: false });
    expect(await attachHash(intent, H("a"), c(tx(H("a"), 7, { from: OTHER })), st)).toMatchObject({ ok: false, reason: expect.stringMatching(/different account/) });
    expect(await attachHash(intent, H("a"), c(tx(H("a"), 7, { to: OTHER })), st)).toMatchObject({ ok: false, reason: expect.stringMatching(/garden/) });
    expect(await attachHash(intent, H("a"), c(tx(H("a"), 6)), st)).toMatchObject({ ok: false, reason: expect.stringMatching(/nonce/) });
    expect(await attachHash(intent, H("a"), c(tx(H("a"), 7, { chainId: 8453 })), st)).toMatchObject({ ok: false });
    expect(saved(st)[0].hash).toBe(INTENT_HASH);
    const ok = await attachHash(intent, H("a"), c(tx(H("a"), 7)), st);
    expect(ok.ok).toBe(true);
    expect(saved(st).map((x) => [x.hash, x.intent, x.nonceChecked])).toEqual([[H("a"), undefined, true]]);
    expect(matchesIntent({ ...intent, kind: "claim" }, tx(H("a"), 7, { input: encodeFunctionData({ abi: wishGardenAbi, functionName: "claimRewards" }) })).ok).toBe(true);
  });
});

describe("review a103c521 / 658d1824: purchase intents are exclusive across tabs and scoped per account", () => {
  it("two tabs: both start a purchase at once; the wallet is asked once and tab B is refused", async () => {
    const map = new Map<string, string>();
    const tabA = new FakeStorage(map), tabB = new FakeStorage(map);
    let asked = 0;
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const buy = async () => { asked++; await gate; throw providerError(4900, "The provider is disconnected from all chains."); };
    const a = runPurchase(baseDeps(tabA, { buy }), [1], ["a"], () => {});
    const b = runPurchase(baseDeps(tabB, { buy }), [1], ["b"], () => {});
    const rb = await b;
    open();
    const ra = await a;
    expect(asked).toBe(1);
    expect(rb).toMatchObject({ name: "error", message: DUPLICATE_MESSAGE });
    expect(ra.name).toBe("buy-unknown");
    // tab A's possibly-broadcast draft is the one kept, so it can still be resolved by its calldata
    const left = saved(tabA);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ hash: intentHash("buy", ME), intent: true, wishes: ["a"] });
  });

  it("a held Web Lock (another tab saving) refuses before the wallet is asked", async () => {
    const st = new FakeStorage();
    let asked = 0;
    const s = await runPurchase(baseDeps(st, { buy: async () => { asked++; return H("a"); }, withLock: async () => "busy" as const }), [1], ["x"], () => {});
    expect(s).toMatchObject({ name: "error", message: DUPLICATE_MESSAGE });
    expect(asked).toBe(0);
    expect(saved(st)).toHaveLength(0);
  });

  it("an uncertain purchase by account A does not lock account B, and releasing B leaves A's intent", async () => {
    const st = new FakeStorage();
    const a = await runPurchase(baseDeps(st, { buy: async () => { throw providerError(4900, "disconnected"); } }), [1], ["a"], () => {});
    expect(a.name).toBe("buy-unknown");
    let bAsked = 0;
    const b = await runPurchase(baseDeps(st, { account: OTHER, buy: async () => { bAsked++; throw providerError(4900, "disconnected"); } }), [2], ["b"], () => {});
    expect(b.name).toBe("buy-unknown");
    expect(bAsked).toBe(1);
    expect(saved(st).map((t) => t.hash).sort()).toEqual([intentHash("buy", ME), intentHash("buy", OTHER)].sort());
    removeBuyIntent(saved(st).find((t) => t.account === OTHER)!, st);
    expect(saved(st).map((t) => t.account)).toEqual([ME]);
    // a legacy shared intent belongs to whoever wrote it: releasing another account leaves it
    pendingStore.persist({ hash: INTENT_HASH, kind: "buy", intent: true, account: OTHER, createdAt: 0 }, st);
    removeBuyIntent(saved(st).find((t) => t.account === ME)!, st);
    expect(saved(st).map((t) => [t.hash, t.account])).toEqual([[INTENT_HASH, OTHER]]);
    removeBuyIntent(saved(st)[0], st);
    expect(saved(st)).toHaveLength(0);
  });
});

describe("finding 2: a claim intent is saved before the wallet is asked", () => {
  const claimDeps = (storage: Storage, over: Partial<ClaimDeps> = {}): ClaimDeps => ({
    account: ME, storage, simulate: async () => ({}), submission: async () => ({ nonce: 3, block: 50n }),
    send: async () => H("c"), wait: async (hash) => ({ ok: true, amount: 5n, hash }), explain: (e) => explainError(e), ...over,
  });

  it("storage quota: nothing is sent", async () => {
    const st = new FakeStorage();
    st.failWrites = true;
    let sent = 0;
    const s = await runClaim(claimDeps(st, { send: async () => { sent++; return H("c"); } }), () => {});
    expect(s).toEqual({ s: "error", msg: CLAIM_STORAGE_MESSAGE });
    expect(sent).toBe(0);
  });

  it("the intent is in storage when the wallet is asked; a validated receipt clears it", async () => {
    const st = new FakeStorage();
    let seen: PendingTx[] = [];
    const s = await runClaim(claimDeps(st, { send: async () => { seen = saved(st); return H("c"); } }), () => {});
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: "claim", intent: true, account: ME, nonce: 3, block: "50", hash: intentHash("claim", ME) });
    expect(s).toMatchObject({ s: "done", amount: 5n });
    expect(saved(st)).toHaveLength(0);
  });

  it("broadcast-then-4900 and reload: the claim stays uncertain and no second claim is offered", async () => {
    const map = new Map<string, string>();
    const s = await runClaim(claimDeps(new FakeStorage(map), { send: async () => { throw providerError(4900, "disconnected"); } }), () => {});
    expect(s.s).toBe("uncertain");
    let sent = 0;
    const again = await runClaim(claimDeps(new FakeStorage(map), { send: async () => { sent++; return H("d"); } }), () => {});
    expect(again).toEqual({ s: "error", msg: CLAIM_BUSY_MESSAGE });
    expect(sent).toBe(0);
    // a different account is not locked by this one (locks are per account)
    const other = await runClaim(claimDeps(new FakeStorage(map), { account: OTHER }), () => {});
    expect(other.s).toBe("done");
  });

  it("two tabs: while tab A waits for the wallet, tab B cannot claim", async () => {
    const map = new Map<string, string>();
    let release!: (h: Hash) => void;
    const steps: ClaimStep[] = [];
    const a = runClaim(claimDeps(new FakeStorage(map), { send: () => new Promise<Hash>((r) => (release = r)) }), (x) => steps.push(x));
    await new Promise((r) => setTimeout(r, 10));
    let sentB = 0;
    const b = await runClaim(claimDeps(new FakeStorage(map), { send: async () => { sentB++; return H("d"); } }), () => {});
    expect(b).toEqual({ s: "error", msg: CLAIM_BUSY_MESSAGE });
    expect(sentB).toBe(0);
    release(H("c"));
    expect((await a).s).toBe("done");
  });

  it("saving the hash fails after submission: the earlier intent is retained for reconciliation", async () => {
    const st = new FakeStorage();
    let pendingAt = 0;
    const s = await runClaim(claimDeps(st, {
      send: async () => { st.failWrites = true; return H("c"); },
      wait: async () => { pendingAt = 1; throw new Error("receipt timeout"); },
    }), () => {});
    expect(pendingAt).toBe(1);
    expect(s.s).toBe("uncertain");
    const back = pendingStore.list(new FakeStorage(st.map));
    expect(back.some((t) => t.intent && t.kind === "claim")).toBe(true);
  });
});

describe("finding 3: the lit total is the contract's totalCandles, not loaded records", () => {
  const rec = (id: number): Candle => ({ id, purchaser: ME, style: id % 7, wish: "", timestamp: 0 } as unknown as Candle);
  it("partial RPC failure keeps the verified total and labels the loaded share as incomplete", async () => {
    let calls = 0;
    const src: CandleSource = {
      kind: "fixture", total: async () => 250,
      page: async (first, limit) => { if (++calls > 1) throw new Error("HTTP request failed"); return Array.from({ length: limit }, (_, i) => rec(first + i)); },
      one: async (id) => rec(id), idsOf: async () => [],
    };
    const store = new CandleStore(src, null);
    await store.sync();
    const st = store.state;
    expect(st.total).toBe(250);
    expect(st.candles.length).toBe(100);
    expect(countLine({ total: st.total, loaded: st.candles.length, loading: st.loading, error: st.error }))
      .toEqual({ lit: "250 lit", loaded: "loaded 100 of 250", incomplete: true, retry: true });
  });
  it("an unknown total is unavailable, never zero; a verified zero is zero", () => {
    expect(countLine({ total: null, loaded: 0, loading: false, error: "x" }).lit).toBe("Total lit: unavailable");
    expect(countLine({ total: null, loaded: 0, loading: true, error: null }).lit).not.toMatch(/\b0\b/);
    expect(countLine({ total: 0, loaded: 0, loading: false, error: null })).toEqual({ lit: "0 lit", loaded: null, incomplete: false, retry: false });
    expect(countLine({ total: 10000, loaded: 10000, loading: false, error: null }).lit).toBe("10,000 lit");
  });
});

describe("finding 4: approval confirmed, then the purchase was re-planned", () => {
  it("reports the approval separately, never says nothing was sent, and does not approve again", async () => {
    const st = new FakeStorage();
    let allowance = 0n, approvals = 0;
    const d = baseDeps(st, {
      allowance: async () => allowance,
      approve: async (amt) => { approvals++; allowance = amt; return H("e"); },
      simulate: async () => { throw new Error("RESPLIT:3:900000"); },
    });
    const s = await runPurchase(d, [0, 0, 0, 0, 0], ["", "", "", "", ""], () => {});
    expect(s.name).toBe("error");
    if (s.name !== "error") return;
    expect(s.approval).toMatchObject({ hash: H("e"), allowance: 5n * 10n ** 18n });
    expect(s.message).not.toMatch(/Nothing was sent/);
    expect(s.message).toMatch(/candle purchase was not sent/);
    expect(APPROVED_NOT_SENT).toBe("Approval confirmed; candle purchase not sent.");
    // the revised purchase (3 candles) needs a fresh confirmation; the existing allowance covers it
    const ok = await runPurchase({ ...d, simulate: async () => ({}), wait: async () => ({ status: "success", purchase: { purchaser: ME, firstId: 1, quantity: 3 }, created: [1, 2, 3].map((id) => ({ id, purchaser: ME, style: 0, wish: "" })), from: ME, to: GARDEN, call: { styles: [0, 0, 0], wishes: ["", "", ""] } }) }, [0, 0, 0], ["", "", ""], () => {});
    expect(ok.name).toBe("done");
    expect(approvals).toBe(1);
  });
});

beforeEach(() => { /* every test uses its own FakeStorage */ });
