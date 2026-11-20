// @vitest-environment jsdom
/**
 * Revision 15 regression tests for the two transaction-state findings of the final review of job 959f20ae.
 * MOCKED: labelled in-memory/jsdom storage shared by simulated tabs, mock wallets and mock receipt reads. Nothing here
 * talks to a chain or a wallet; these are not live-chain transaction tests.
 *
 * Finding 1 (claim.ts): an older claim's delayed receipt replaced a newer claim's completed result.
 * Finding 2 (purchase.ts): a known-hash approval settled in another tab left this tab at "Approval sent. Waiting...".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, type Hash } from "viem";
import {
  APPROVAL_SETTLED_OK, APPROVAL_SETTLED_REPLACED, APPROVAL_SETTLED_REVERTED, APPROVAL_SETTLED_UNVERIFIED,
  WALLET_CHANGED_MESSAGE, approvalOutcome, isRunning, pendingStore, purchaseFlow, runPurchase, storedEntries,
  type ApprovalEvidence, type PendingTx, type PurchaseDeps, type Receipt, type Step,
} from "../src/lib/purchase";
import { CLAIM_SETTLED_ELSEWHERE, CLAIM_UNCERTAIN_MESSAGE, createClaimBoard, runClaim, type ClaimDeps, type ClaimStep } from "../src/lib/claim";
import { isGardenApproval } from "../src/lib/intent";
import { GARDEN, IMD } from "../src/config";

/** Labelled fixture storage shared by two simulated tabs (same origin, same localStorage). */
class SharedStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const asS = (s: SharedStorage) => s as unknown as Storage;
const ME = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const H = (c: string) => (`0x${c.repeat(64)}`.slice(0, 66)) as Hash;
const err = (code: number, message: string) => Object.assign(new Error(message), { code });
function deferred<T>() { let res!: (v: T) => void, rej!: (e: unknown) => void; const p = new Promise<T>((a, b) => { res = a; rej = b; }); return { p, res, rej }; }
const tick = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const IMD1 = 10n ** 18n;

// ---------------------------------------------------------------------------------------------------------------
// Finding 1: claims
// ---------------------------------------------------------------------------------------------------------------
type Verdict = { ok: boolean; amount?: bigint; message?: string; unverified?: boolean; hash: Hash };
/** Tab A's claim run, wired exactly like RewardsPanel: new attempts become the account's latest when created. */
function claimDeps(st: SharedStorage, board: ReturnType<typeof createClaimBoard>, id: string, over: Partial<ClaimDeps> & { account?: string } = {}): ClaimDeps {
  const account = over.account ?? ME;
  return {
    account, storage: asS(st),
    simulate: async () => ({ req: id }),
    submission: async () => ({ nonce: 3, block: 100n }),
    send: async () => H(id.slice(-1)),
    wait: async (h) => ({ ok: true, amount: IMD1, hash: h }),
    explain: (e) => (e instanceof Error ? e.message : String(e)),
    newAttempt: () => { board.begin(account, id); return id; },
    ...over,
  };
}
const offerTo = (board: ReturnType<typeof createClaimBoard>, account = ME) => (s: ClaimStep) => { board.offer(account, s); };
const savedClaims = (st: SharedStorage) => storedEntries(asS(st)).filter((t) => t.kind === "claim");

describe("finding 1: an older claim's delayed receipt never replaces a newer claim's result (MOCKED)", () => {
  it("reviewer's sequence: A resolved in another tab, B completes, A's delayed receipt arrives → B stays the displayed result", async () => {
    const st = new SharedStorage();
    const board = createClaimBoard(pendingStore, asS(st));
    const released: string[] = [];
    board.onRelease((a, at) => released.push(`${a}:${at}`));
    const waitA = deferred<Verdict>();
    // tab A submits claim A; its receipt response is delayed
    const runA = runClaim(claimDeps(st, board, "claimA", { send: async () => H("a"), wait: () => waitA.p }), offerTo(board));
    await tick();
    expect(board.step(ME)).toMatchObject({ s: "pending", hash: H("a"), attempt: "claimA" });
    // tab B resolves claim A and clears its durable record; this tab hears the storage event
    pendingStore.removeAttempt("claimA", asS(st));
    board.reconcile();
    expect(board.step(ME)).toMatchObject({ s: "resolved", msg: CLAIM_SETTLED_ELSEWHERE, hash: H("a"), attempt: "claimA" });
    expect(released).toEqual([`${ME.toLowerCase()}:claimA`]);
    // tab A becomes available, submits claim B and shows B's successful receipt
    const b = await runClaim(claimDeps(st, board, "claimB", { send: async () => H("b"), wait: async (h) => ({ ok: true, amount: 5n * IMD1, hash: h }) }), offerTo(board));
    expect(b).toMatchObject({ s: "done", hash: H("b"), amount: 5n * IMD1 });
    expect(board.step(ME)).toMatchObject({ s: "done", hash: H("b"), amount: 5n * IMD1, attempt: "claimB" });
    // A's delayed callback arrives with its own (older) successful result
    waitA.res({ ok: true, amount: 2n * IMD1, hash: H("a") });
    const a = await runA;
    expect(a).toMatchObject({ s: "done", hash: H("a"), attempt: "claimA" });
    // B remains the displayed result: amount, receipt link and state are B's
    expect(board.step(ME)).toMatchObject({ s: "done", hash: H("b"), amount: 5n * IMD1, attempt: "claimB" });
    // A's outcome stays available as history, beside (never instead of) the current result
    expect(board.history(ME)).toEqual([expect.objectContaining({ s: "done", hash: H("a"), amount: 2n * IMD1, attempt: "claimA" })]);
    expect(board.latest(ME)).toBe("claimB");
  });

  it("A's delayed error, timeout (uncertain) or manual check never overwrites B, whether B is running or completed", async () => {
    const st = new SharedStorage();
    const board = createClaimBoard(pendingStore, asS(st));
    const waitA = deferred<Verdict>();
    const runA = runClaim(claimDeps(st, board, "cA2", { wait: () => waitA.p }), offerTo(board));
    await tick();
    pendingStore.removeAttempt("cA2", asS(st));
    board.reconcile();
    // B is still pending (running) when A's receipt read fails: A's "uncertain" can neither re-lock nor replace B
    const waitB = deferred<Verdict>();
    const runB = runClaim(claimDeps(st, board, "cB2", { send: async () => H("b"), wait: () => waitB.p }), offerTo(board));
    await tick();
    expect(board.step(ME)).toMatchObject({ s: "pending", attempt: "cB2" });
    waitA.rej(new Error("RPC unavailable"));
    expect(await runA).toMatchObject({ s: "uncertain", msg: expect.any(String) });
    expect(board.step(ME)).toMatchObject({ s: "pending", hash: H("b"), attempt: "cB2" });
    // B's record is untouched by A's late callback
    expect(savedClaims(st).map((t) => t.attempt)).toEqual(["cB2"]);
    // a manual check of A that finishes late (its outcome was settled elsewhere) is history only
    expect(board.begin(ME, "cA2")).toBe(false); // refused: B is live
    board.offer(ME, { s: "error", msg: "The claim reverted onchain. Only gas was spent.", attempt: "cA2" });
    expect(board.step(ME)).toMatchObject({ s: "pending", attempt: "cB2" });
    waitB.res({ ok: false, message: "The claim reverted onchain. Only gas was spent.", hash: H("b") });
    await runB;
    // B's own revert is B's displayed error; A's late error went to history
    expect(board.step(ME)).toMatchObject({ s: "error", attempt: "cB2" });
    expect(board.history(ME).map((h) => h.attempt)).toEqual(["cA2"]);
    expect(savedClaims(st)).toHaveLength(0);
  });

  it("a released attempt's own final outcome still replaces its 'resolved' step while it is the latest attempt", async () => {
    const st = new SharedStorage();
    const board = createClaimBoard(pendingStore, asS(st));
    const waitA = deferred<Verdict>();
    const runA = runClaim(claimDeps(st, board, "cA3", { wait: () => waitA.p }), offerTo(board));
    await tick();
    pendingStore.removeAttempt("cA3", asS(st));
    board.reconcile();
    expect(board.step(ME).s).toBe("resolved");
    waitA.res({ ok: true, amount: 3n * IMD1, hash: H("a") });
    await runA;
    expect(board.step(ME)).toMatchObject({ s: "done", amount: 3n * IMD1, attempt: "cA3" });
  });

  it("account isolation: another account's claim never touches this account's display, and switching back restores it", async () => {
    const st = new SharedStorage();
    const board = createClaimBoard(pendingStore, asS(st));
    const waitMe = deferred<Verdict>();
    const runMe = runClaim(claimDeps(st, board, "cMe", { wait: () => waitMe.p }), offerTo(board, ME));
    await tick();
    await runClaim(claimDeps(st, board, "cOther", { account: OTHER, send: async () => H("c"), wait: async (h) => ({ ok: true, amount: 7n, hash: h }) }), offerTo(board, OTHER));
    expect(board.step(OTHER)).toMatchObject({ s: "done", amount: 7n, attempt: "cOther" });
    waitMe.res({ ok: true, amount: 4n, hash: H("m") });
    await runMe;
    expect(board.step(ME)).toMatchObject({ s: "done", amount: 4n, attempt: "cMe" });
    expect(board.step(OTHER)).toMatchObject({ s: "done", amount: 7n, attempt: "cOther" });
  });

  it("rejected signature releases only that attempt; unavailable RPC keeps the record and Claim locked; wallet change sends nothing", async () => {
    const st = new SharedStorage();
    const board = createClaimBoard(pendingStore, asS(st));
    let sent = 0;
    const rejected = await runClaim(claimDeps(st, board, "cRej", { send: async () => { sent++; throw err(4001, "User rejected the request."); } }), offerTo(board));
    expect(rejected).toMatchObject({ s: "error", attempt: "cRej" });
    expect(savedClaims(st)).toHaveLength(0);
    const changed = await runClaim(claimDeps(st, board, "cChg", {
      walletState: async () => ({ account: OTHER, chainId: 1 }), send: async () => { sent++; return H("x"); },
    }), offerTo(board));
    expect(changed).toMatchObject({ s: "error", msg: expect.stringContaining("changed") });
    expect(sent).toBe(1); // only the rejected request reached the wallet
    const down = await runClaim(claimDeps(st, board, "cDown", { send: async () => { throw err(-32603, "Internal JSON-RPC error."); } }), offerTo(board));
    expect(down).toMatchObject({ s: "uncertain", msg: CLAIM_UNCERTAIN_MESSAGE });
    expect(savedClaims(st).map((t) => t.attempt)).toEqual(["cDown"]); // stays saved: Claim stays off
    board.reconcile();
    expect(board.step(ME)).toMatchObject({ s: "uncertain", attempt: "cDown" }); // not released while its record exists
  });

  it("single-tab claim: wallet → pending → done, record removed", async () => {
    const st = new SharedStorage();
    const board = createClaimBoard(pendingStore, asS(st));
    const seen: string[] = [];
    const r = await runClaim(claimDeps(st, board, "cOne"), (s) => { seen.push(s.s); board.offer(ME, s); });
    expect(seen).toEqual(["wallet", "pending", "done"]);
    expect(r).toMatchObject({ s: "done", attempt: "cOne" });
    expect(board.step(ME)).toMatchObject({ s: "done", attempt: "cOne" });
    expect(savedClaims(st)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Finding 2: approvals settled in another tab
// ---------------------------------------------------------------------------------------------------------------
const okBuy = (hash: Hash, styles: number[], wishes: string[], firstId = 1): Receipt => ({
  status: "success", hash,
  purchase: { purchaser: ME, firstId, quantity: styles.length },
  created: styles.map((s, i) => ({ id: firstId + i, purchaser: ME, style: s, wish: wishes[i] })),
  from: ME, to: GARDEN, call: { styles, wishes },
});
const approveInput = (amount: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GARDEN, amount] });
/** Labelled mock of the panel's chain-backed verifier: a receipt, its mined transaction and the live allowance. */
function mockVerifier(e: (tx: PendingTx) => ApprovalEvidence | Promise<ApprovalEvidence>) {
  const calls: PendingTx[] = [];
  purchaseFlow.setApprovalVerifier(async (tx) => { calls.push(tx); return approvalOutcome(tx, await e(tx), isGardenApproval); });
  return calls;
}
const confirmed = (allowance: bigint) => (tx: PendingTx): ApprovalEvidence => ({
  receipt: { status: "success", hash: tx.hash }, mined: { from: ME, to: IMD, input: approveInput(BigInt(tx.amount!)) }, allowance,
});

/** Tab A wired like LightPanel.submit: the run lock learns each step's attempt, and steps are reported with their run. */
function tabA() {
  const locks = new Map<string, { attempt?: string }>();
  const off = purchaseFlow.onRelease((account, attempt) => { const k = account.toLowerCase(); if (locks.get(k)?.attempt === attempt) locks.delete(k); });
  const log: [Step, string, string][] = [];
  async function submit(d: PurchaseDeps, styles = [1], wishes = ["w"]) {
    const k = d.account.toLowerCase();
    if (locks.has(k) || isRunning(purchaseFlow.for(d.account))) return "blocked" as const;
    const run: { attempt?: string } = {};
    locks.set(k, run);
    try {
      return await runPurchase(d, styles, wishes, (s, attempt, runId) => {
        if (locks.get(k) === run) run.attempt = attempt;
        log.push([s, attempt, runId]);
        purchaseFlow.report(attempt, s, d.account, runId);
      });
    } finally {
      if (locks.get(k) === run) locks.delete(k);
    }
  }
  return { locks, log, submit, off };
}

let n = 0;
function pdeps(over: Partial<PurchaseDeps> & { ids?: string[] } = {}): PurchaseDeps & { buys: number } {
  const ids = over.ids ?? [`P${++n}`, `AP${n}`];
  let i = 0;
  const d = {
    account: ME, chainId: () => 1, salesOpen: async () => true,
    balance: async () => 10n ** 20n, allowance: async () => 0n, ethBalance: async () => 10n ** 18n,
    approve: async () => H("e"),
    wait: async (h: Hash) => (h === H("e") ? { status: "success" as const, hash: h } : okBuy(h, [1], ["w"])),
    simulate: async () => ({ req: true }),
    buy: async () => { d.buys++; return H("b"); },
    submission: async () => ({ nonce: 7, block: 100n }),
    explain: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    newAttempt: () => ids[i++] ?? `X${n}-${i}`,
    buys: 0,
    ...over,
  };
  return d as PurchaseDeps & { buys: number };
}
const saved = () => storedEntries(localStorage);

beforeEach(() => { localStorage.clear(); purchaseFlow.set(null); });
afterEach(() => { purchaseFlow.setApprovalVerifier(null); purchaseFlow.set(null); localStorage.clear(); });

describe("finding 2: a known-hash approval settled in another tab is reconciled here (MOCKED)", () => {
  it("reviewer's sequence: tab B confirms and clears the approval while tab A's receipt read is delayed → A recovers, keeps the link, needs a fresh click", async () => {
    const calls = mockVerifier(confirmed(IMD1));
    const A = tabA();
    const receipt = deferred<Receipt>();
    const d = pdeps({ ids: ["P-rv", "AP-rv"], approve: async () => H("e"), wait: (h) => (h === H("e") ? receipt.p : Promise.resolve(okBuy(h, [1], ["w"]))) });
    const run = A.submit(d);
    await tick();
    // tab A: "Approval sent. Waiting..." bound to the APPROVAL's own attempt, inside the purchase run
    expect(purchaseFlow.get()).toMatchObject({ name: "approve-pending", hash: H("e") });
    expect(purchaseFlow.attempt()).toBe("AP-rv");
    expect(purchaseFlow.run()).toBe("P-rv");
    expect(A.locks.get(ME.toLowerCase())?.attempt).toBe("AP-rv");
    expect(saved().map((t) => t.attempt)).toEqual(["AP-rv"]);
    // tab B confirms the same approval and clears its durable record (storage event in tab A)
    pendingStore.removeAttempt("AP-rv");
    // released at once: not running, lock dropped, link kept, verification started (not inferred from the removal)
    expect(purchaseFlow.get()).toMatchObject({ name: "approve-settled", hash: H("e") });
    expect(isRunning(purchaseFlow.get())).toBe(false);
    expect(A.locks.has(ME.toLowerCase())).toBe(false);
    await tick();
    expect(calls.map((t) => t.attempt)).toEqual(["AP-rv"]);
    expect(calls[0]).toMatchObject({ hash: H("e"), amount: IMD1.toString(), account: ME });
    // verified from the receipt and allowance: success, approval receipt kept, purchase NOT sent
    expect(purchaseFlow.get()).toMatchObject({ name: "error", message: APPROVAL_SETTLED_OK, approval: { hash: H("e"), allowance: IMD1 } });
    expect(d.buys).toBe(0);
    // the original receipt finally arrives: it does not relock, overwrite or resume the purchase
    receipt.res({ status: "success", hash: H("e") });
    await run;
    expect(d.buys).toBe(0);
    expect(purchaseFlow.get()).toMatchObject({ name: "error", message: APPROVAL_SETTLED_OK, approval: { hash: H("e") } });
    expect(A.log.some(([s]) => s.name === "simulating" || s.name === "buy-wallet")).toBe(false);
    // a fresh explicit click: the allowance now covers it, no second approval, the purchase is sent once and lights
    const approvals: bigint[] = [];
    const d2 = pdeps({ ids: ["P-rv2"], allowance: async () => IMD1, expectApproval: false, approve: async (a) => { approvals.push(a); return H("f"); } });
    const s2 = await A.submit(d2);
    expect(s2).toMatchObject({ name: "done", hash: H("b") });
    expect(approvals).toEqual([]);
    expect(d2.buys).toBe(1);
    expect(purchaseFlow.get()).toMatchObject({ name: "done" });
    expect(purchaseFlow.run()).toBe("P-rv2");
    A.off();
  });

  it("a delayed callback after recovery never overwrites a newer attempt or sends a purchase (success, failure and rejection of the old wait)", async () => {
    mockVerifier(confirmed(IMD1));
    const A = tabA();
    const r1 = deferred<Receipt>();
    const d1 = pdeps({ ids: ["P-old", "AP-old"], wait: (h) => (h === H("e") ? r1.p : Promise.resolve(okBuy(h, [1], ["w"]))) });
    const old = A.submit(d1);
    await tick();
    pendingStore.removeAttempt("AP-old"); // settled in another tab
    await tick();
    // newer attempt: started explicitly, still running when the old receipt arrives
    const buyHash = deferred<Receipt>();
    const d2 = pdeps({ ids: ["P-new"], allowance: async () => IMD1, expectApproval: false, wait: () => buyHash.p });
    const newer = A.submit(d2);
    await tick();
    expect(purchaseFlow.get()).toMatchObject({ name: "buy-pending" });
    r1.res({ status: "success", hash: H("e") });
    await old;
    expect(d1.buys).toBe(0);
    expect(purchaseFlow.get()).toMatchObject({ name: "buy-pending" });
    expect(purchaseFlow.run()).toBe("P-new");
    buyHash.res(okBuy(H("b"), [1], ["w"]));
    await newer;
    expect(purchaseFlow.get()).toMatchObject({ name: "done", hash: H("b") });
    // a stale report of the old run (any step) can no longer replace the newer completed result
    expect(purchaseFlow.report("AP-old", { name: "approve-unknown", hash: H("e"), message: "late" }, ME, "P-old")).toBe(false);
    expect(purchaseFlow.report("AP-old", { name: "error", message: "late old outcome" }, ME, "P-old")).toBe(false);
    expect(purchaseFlow.report("P-old", { name: "simulating" }, ME, "P-old")).toBe(false);
    expect(purchaseFlow.get()).toMatchObject({ name: "done", hash: H("b") });
    expect(purchaseFlow.history().some((h) => h.run === "P-old")).toBe(true);
    expect(d2.buys).toBe(1);

    // the old wait failing (RPC down) after release also never relocks as approve-unknown
    const r3 = deferred<Receipt>();
    const d3 = pdeps({ ids: ["P-f", "AP-f"], wait: () => r3.p });
    const f = A.submit(d3);
    await tick();
    pendingStore.removeAttempt("AP-f");
    await tick();
    const shown = purchaseFlow.get();
    r3.rej(new Error("RPC unavailable"));
    await f;
    expect(purchaseFlow.get()).toBe(shown);
    expect(isRunning(purchaseFlow.get())).toBe(false);
    expect(d3.buys).toBe(0);
    A.off();
  });

  it("verified outcomes: revert, cancellation/replacement, and an unavailable RPC (unresolved, then Check again)", async () => {
    const A = tabA();
    const run = async (id: string, evidence: (tx: PendingTx) => ApprovalEvidence | Promise<ApprovalEvidence>) => {
      mockVerifier(evidence);
      const never = deferred<Receipt>();
      const d = pdeps({ ids: [`P-${id}`, `AP-${id}`], wait: () => never.p });
      void A.submit(d);
      await tick();
      pendingStore.removeAttempt(`AP-${id}`);
      await tick();
      return d;
    };
    const rev = await run("rev", (tx) => ({ receipt: { status: "reverted", hash: tx.hash }, mined: null }));
    expect(purchaseFlow.get()).toMatchObject({ name: "error", message: APPROVAL_SETTLED_REVERTED, hash: H("e") });
    expect(rev.buys).toBe(0);
    await run("rep", () => ({ receipt: { status: "success", hash: H("9") }, mined: { from: ME, to: ME, input: "0x" } }));
    expect(purchaseFlow.get()).toMatchObject({ name: "error", message: APPROVAL_SETTLED_REPLACED, hash: H("9") });
    // RPC unavailable: never shown as confirmed; not running (the form is usable), link kept, explicit Check again
    let up = false;
    const down = await run("down", (tx) => { if (!up) throw new Error("RPC unavailable"); return confirmed(IMD1)(tx); });
    expect(purchaseFlow.get()).toMatchObject({ name: "approve-settled", message: APPROVAL_SETTLED_UNVERIFIED, hash: H("e"), checking: false });
    expect(isRunning(purchaseFlow.get())).toBe(false);
    expect(A.locks.has(ME.toLowerCase())).toBe(false);
    up = true;
    await purchaseFlow.recheckApproval();
    expect(purchaseFlow.get()).toMatchObject({ name: "error", message: APPROVAL_SETTLED_OK, approval: { hash: H("e"), allowance: IMD1 } });
    expect(down.buys).toBe(0);
    // a receipt but no readable allowance / an allowance below the approved amount are stated, never assumed
    expect(approvalOutcome({ hash: H("e"), kind: "approve", account: ME, createdAt: 1, amount: "5" }, { receipt: { status: "success", hash: H("e") }, mined: { from: ME, to: IMD, input: approveInput(5n) } }, isGardenApproval)).toMatchObject({ name: "error", hash: H("e") });
    expect(approvalOutcome({ hash: H("e"), kind: "approve", account: ME, createdAt: 1, amount: "5" }, { receipt: { status: "success", hash: H("e") }, mined: { from: ME, to: IMD, input: approveInput(5n) }, allowance: 1n }, isGardenApproval)).toMatchObject({ name: "error", allowance: { allowance: 1n } });
    A.off();
  });

  it("the parent purchase attempt is not confused with the approval attempt: an unrelated purchase record change does not release it", async () => {
    mockVerifier(confirmed(IMD1));
    const A = tabA();
    const never = deferred<Receipt>();
    void A.submit(pdeps({ ids: ["P-iso", "AP-iso"], wait: () => never.p }));
    await tick();
    // another account's attempt, and this purchase's (never-saved) parent id, settling: the approval stays pending
    pendingStore.persist({ hash: H("7"), kind: "buy", account: OTHER, createdAt: 2, attempt: "other" });
    pendingStore.removeAttempt("other");
    pendingStore.removeAttempt("P-iso");
    expect(purchaseFlow.get()).toMatchObject({ name: "approve-pending", hash: H("e") });
    expect(A.locks.get(ME.toLowerCase())?.attempt).toBe("AP-iso");
    A.off();
  });

  it("single-tab flows still work: uninterrupted approval → purchase, approval steps carry the approval's own attempt", async () => {
    const calls = mockVerifier(confirmed(IMD1));
    const A = tabA();
    let reads = 0;
    const d = pdeps({ ids: ["P-one", "AP-one"], allowance: async () => (reads++ === 0 ? 0n : IMD1) });
    const s = await A.submit(d);
    expect(s).toMatchObject({ name: "done", hash: H("b") });
    expect(d.buys).toBe(1);
    expect(calls).toHaveLength(0); // this tab's own receipt removed the record: not a cross-tab settlement
    expect(A.log.map(([x, at, r]) => `${x.name}:${at}:${r}`)).toEqual([
      "checking:P-one:P-one", "approve-wallet:AP-one:P-one", "approve-pending:AP-one:P-one",
      "simulating:P-one:P-one", "buy-wallet:P-one:P-one", "buy-pending:P-one:P-one", "done:P-one:P-one",
    ]);
    expect(saved()).toHaveLength(0);
    A.off();
  });

  it("rejected approval signature, wallet change and reverted approval in one tab keep attempts isolated", async () => {
    const A = tabA();
    const rej = await A.submit(pdeps({ ids: ["P-r", "AP-r"], approve: async () => { throw err(4001, "User rejected the request."); } }));
    expect(rej).toMatchObject({ name: "error" });
    expect(saved()).toHaveLength(0);
    let revs = 0;
    const chg = await A.submit(pdeps({ ids: ["P-c", "AP-c"], binding: { revision: () => revs++ } }));
    expect(chg).toMatchObject({ name: "error", message: WALLET_CHANGED_MESSAGE });
    expect(saved()).toHaveLength(0);
    const bad = pdeps({ ids: ["P-v", "AP-v"], wait: async (h) => ({ status: "reverted", hash: h }) });
    const v = await A.submit(bad);
    expect(v).toMatchObject({ name: "error", message: expect.stringContaining("reverted") });
    expect(bad.buys).toBe(0);
    expect(purchaseFlow.attempt()).toBe("AP-v");
    expect(saved()).toHaveLength(0);
    // unavailable RPC for the approval receipt in a single tab: approve-unknown, record kept, form locked on it
    const down = pdeps({ ids: ["P-d", "AP-d"], wait: async () => { throw new Error("RPC unavailable"); } });
    const u = await A.submit(down);
    expect(u).toMatchObject({ name: "approve-unknown", hash: H("e") });
    expect(saved().map((t) => t.attempt)).toEqual(["AP-d"]);
    expect(isRunning(purchaseFlow.get())).toBe(true);
    // ...and when another tab then settles that known hash, it is verified here too (not just cleared)
    mockVerifier((tx) => ({ receipt: { status: "reverted", hash: tx.hash }, mined: null }));
    pendingStore.removeAttempt("AP-d");
    await tick();
    expect(purchaseFlow.get()).toMatchObject({ name: "error", message: APPROVAL_SETTLED_REVERTED, hash: H("e") });
    A.off();
  });
});
