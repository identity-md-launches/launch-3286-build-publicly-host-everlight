import type { Hash } from "viem";
import { intentHash, isProvenRejection } from "./intent";
import { WALLET_CHANGED_MESSAGE, attemptOf, newAttemptId, pendingStore, reconcileSent, walletStillBound, type PendingTx, type WalletBinding, type WalletState } from "./purchase";

/**
 * Manual reward claim with a durable intent. Order (the fix for "claims sent before an intent was recorded"):
 *  1. no saved or uncertain claim for this account (any tab) — otherwise no second claim is offered;
 *  2. storage preflight — if this browser cannot save, nothing is sent;
 *  3. simulate, then read the sender's nonce and the submission block;
 *  4. persist the claim intent (exclusive per account across tabs, read back) BEFORE the wallet is asked;
 *  5. send; a proven rejection releases the intent, anything else keeps it (the wallet may have broadcast);
 *  6. replace the intent with the hash (a failed write keeps the intent saved), then settle from the receipt.
 */
/** attempt: the durable claim attempt a step belongs to; the panel reconciles its step with that attempt's record. */
export type ClaimStep = (
  | { s: "idle" }
  | { s: "wallet" }
  | { s: "pending"; hash: Hash }
  /** The claim may have been sent: the intent stays saved and Claim stays off until it is reconciled. */
  | { s: "uncertain"; msg: string }
  | { s: "done"; hash: Hash; amount: bigint }
  | { s: "error"; msg: string }
  /** The attempt's record was settled elsewhere (another tab, or its receipt): Claim is released, the link kept. */
  | { s: "resolved"; msg: string; hash?: Hash }
) & { attempt?: string };

export const CLAIM_SETTLED_ELSEWHERE =
  "That claim was settled in another tab or by its receipt, so this tab stopped waiting for it. Your rewards were re-read.";
const claimRunning = (s: ClaimStep | null) => !!s && (s.s === "wallet" || s.s === "pending" || s.s === "uncertain");
/**
 * May a step reported by a claim run replace the shown step? Not when the shown step is a running step of ANOTHER
 * attempt (a delayed callback never overwrites a newer attempt), and not when it would put an attempt that was already
 * settled elsewhere back into a running state. Its own final outcome (done/error) still replaces "resolved".
 */
export function claimStepApplies(cur: ClaimStep | null, next: ClaimStep, released: ReadonlySet<string>): boolean {
  if (next.attempt && released.has(next.attempt) && claimRunning(next)) return false;
  if (cur && cur.attempt && next.attempt && cur.attempt !== next.attempt && claimRunning(cur)) return false;
  return true;
}

/**
 * The claim display of this tab, per account, keyed by attempt identity (the fix for an older claim's delayed receipt
 * replacing a newer claim's completed result). Each account has a LATEST attempt: the one most recently started here
 * or explicitly checked. It is tracked independently of whether the shown step is running or final, so:
 *  - only the latest attempt's steps are shown; an older attempt's late outcome (automatic wait, manual check or
 *    cross-tab settlement) never replaces a newer attempt's result, amount, receipt link or error. Its final outcome
 *    is kept in the account's history instead, shown beside (never instead of) the current result;
 *  - an attempt settled elsewhere is released: its pending or uncertain step becomes "resolved" (link kept), its own
 *    running steps can no longer re-lock Claim, and only its own final outcome may still replace "resolved";
 *  - steps are stored per account, so a claim of one account never touches another account's display.
 */
export interface ClaimBoardStore { get(attempt: string, storage?: Storage | null): PendingTx | null }
export function createClaimBoard(store: ClaimBoardStore = pendingStore, storage?: Storage | null) {
  const key = (a: string) => a.toLowerCase();
  const latest = new Map<string, string>();
  const steps = new Map<string, ClaimStep>();
  const hist = new Map<string, ClaimStep[]>();
  const released = new Set<string>();
  const subs = new Set<() => void>();
  const releaseSubs = new Set<(account: string, attempt: string) => void>();
  let version = 0;
  const notify = () => { version++; subs.forEach((f) => f()); };
  const remember = (account: string, step: ClaimStep) => {
    if (step.s !== "done" && step.s !== "error") return;
    const h = (hist.get(key(account)) ?? []).filter((x) => x.attempt !== step.attempt);
    hist.set(key(account), [...h, step].slice(-3));
  };
  const board = {
    /**
     * Make an attempt the account's latest (a claim starting, or an explicit Check again). Refused while another
     * attempt of this account is still running here and not released, so a check never takes over a live claim.
     */
    begin(account: string, attempt: string): boolean {
      const cur = steps.get(key(account));
      if (cur?.attempt && cur.attempt !== attempt && claimRunning(cur) && !released.has(cur.attempt)) return false;
      latest.set(key(account), attempt);
      return true;
    },
    latest: (account: string): string | null => latest.get(key(account)) ?? null,
    /** A step reported for an account by one attempt. Answers whether it is now the shown step. */
    offer(account: string, step: ClaimStep): boolean {
      const a = step.attempt;
      if (a && released.has(a) && claimRunning(step)) return false;
      if (a && latest.get(key(account)) !== a) {
        const before = hist.get(key(account));
        remember(account, step);
        if (hist.get(key(account)) !== before) notify();
        return false;
      }
      steps.set(key(account), step);
      notify();
      return true;
    },
    /** The shown step of an account (idle when it has none). */
    step: (account: string | null | undefined): ClaimStep => (account ? steps.get(key(account)) ?? { s: "idle" } : { s: "idle" }),
    /** Late final outcomes of this account's earlier attempts, oldest first (never the latest attempt's). */
    history(account: string | null | undefined): readonly ClaimStep[] {
      if (!account) return [];
      const cur = latest.get(key(account));
      return (hist.get(key(account)) ?? []).filter((x) => x.attempt !== cur);
    },
    released: (attempt: string) => released.has(attempt),
    /**
     * Cross-tab settlement: an account whose shown step is its latest attempt's pending or uncertain step, and whose
     * saved record is gone (settled in another tab or by its receipt), is released: "resolved" with its link kept.
     * Answers the released (account, attempt) pairs so the panel drops exactly that run's lock and re-reads rewards.
     */
    reconcile(): { account: string; attempt: string }[] {
      const out: { account: string; attempt: string }[] = [];
      for (const [k, st] of [...steps.entries()]) {
        if ((st.s !== "pending" && st.s !== "uncertain") || !st.attempt || latest.get(k) !== st.attempt) continue;
        if (store.get(st.attempt, storage)) continue;
        released.add(st.attempt);
        steps.set(k, { s: "resolved", msg: CLAIM_SETTLED_ELSEWHERE, hash: st.s === "pending" ? st.hash : undefined, attempt: st.attempt });
        out.push({ account: k, attempt: st.attempt });
      }
      if (out.length) {
        notify();
        out.forEach((r) => releaseSubs.forEach((f) => f(r.account, r.attempt)));
      }
      return out;
    },
    onRelease(f: (account: string, attempt: string) => void) { releaseSubs.add(f); return () => { releaseSubs.delete(f); }; },
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    version: () => version,
  };
  return board;
}
export type ClaimBoard = ReturnType<typeof createClaimBoard>;
/** This tab's claim display; reconciled whenever any tab saves or settles a transaction. */
export const claimBoard = createClaimBoard();
pendingStore.subscribe(() => { claimBoard.reconcile(); });

export interface ClaimVerdictLike { ok: boolean; amount?: bigint; message?: string; unverified?: boolean; hash: Hash }

export interface ClaimDeps {
  account: string;
  storage?: Storage | null;
  simulate: () => Promise<unknown>;
  submission: () => Promise<{ nonce: number; block: bigint }>;
  send: (request: unknown) => Promise<Hash>;
  /** Mined receipt of the claim (following replacements), checked for this account's RewardsClaimed event. */
  wait: (hash: Hash) => Promise<ClaimVerdictLike>;
  sentTx?: (hash: Hash) => Promise<{ from: string; nonce: number } | null>;
  /** Cross-tab mutual exclusion while the intent is written (Web Locks when available). */
  withLock?: <T>(name: string, f: () => Promise<T> | T) => Promise<T | "busy">;
  explain: (e: unknown) => string;
  /** Live wallet account and chain, re-read immediately before the claim is sent. */
  walletState?: () => Promise<WalletState>;
  newAttempt?: () => string;
  /** The initiating click's wallet binding (revision and connector): any change before the send ends it. */
  binding?: WalletBinding;
}

export const CLAIM_STORAGE_MESSAGE =
  "This browser is not letting the site save recovery data (storage is full or blocked), so a claim could not be recovered after a reload. Nothing was sent. Free some site storage or leave private mode, then try again.";
export const CLAIM_BUSY_MESSAGE = "A claim for this wallet is already in progress in this or another tab. Nothing new was sent.";
export const CLAIM_UNCERTAIN_MESSAGE =
  "Your wallet stopped answering before it returned a transaction hash, so this claim may have been sent. It stays saved and Claim stays off so the same rewards are not requested twice. Check again, or paste the hash from your wallet's activity.";

export const claimConflict = (account: string) => (t: PendingTx) => t.kind === "claim" && t.account.toLowerCase() === account.toLowerCase();

export async function runClaim(deps: ClaimDeps, onStep0: (s: ClaimStep) => void): Promise<ClaimStep> {
  const attemptId = (deps.newAttempt ?? newAttemptId)();
  const onStep = (s: ClaimStep) => onStep0({ ...s, attempt: attemptId });
  const end = (s: ClaimStep) => { const t = { ...s, attempt: attemptId }; onStep0(t); return t; };
  const { account, storage } = deps;
  const binding = { ...deps.binding, at: deps.binding?.revision?.() };
  const conflict = claimConflict(account);
  if (pendingStore.list(storage).some(conflict)) return end({ s: "error", msg: CLAIM_BUSY_MESSAGE });
  if (!pendingStore.writable(storage)) return end({ s: "error", msg: CLAIM_STORAGE_MESSAGE });
  onStep({ s: "wallet" });
  let request: unknown;
  let sub: { nonce: number; block: bigint };
  try {
    request = await deps.simulate();
  } catch (e) {
    return end({ s: "error", msg: deps.explain(e) });
  }
  try {
    sub = await deps.submission();
  } catch {
    return end({ s: "error", msg: "Your account's nonce and the current block could not be read. Nothing was sent; try the claim again." });
  }
  const intent: PendingTx = {
    hash: intentHash("claim", account), kind: "claim", intent: true, account, createdAt: Date.now(),
    from: account, nonce: sub.nonce, block: sub.block.toString(), nonceChecked: false, attempt: attemptId,
  };
  const attempt = attemptOf(intent);
  const write = () => pendingStore.persistExclusive(intent, conflict, storage);
  const saved = deps.withLock ? await deps.withLock(`everlight-claim-${account.toLowerCase()}`, write) : write();
  if (saved === "busy" || saved === "conflict") return end({ s: "error", msg: CLAIM_BUSY_MESSAGE });
  if (saved !== "saved") return end({ s: "error", msg: CLAIM_STORAGE_MESSAGE });

  if ((deps.walletState || binding.revision) && !(await walletStillBound(account, deps.walletState, deps.walletState ? undefined : () => 1, binding))) {
    pendingStore.removeAttempt(attempt, storage);
    return end({ s: "error", msg: WALLET_CHANGED_MESSAGE });
  }
  let hash: Hash;
  try {
    hash = await deps.send(request);
  } catch (e) {
    if (isProvenRejection(e)) {
      pendingStore.removeAttempt(attempt, storage);
      return end({ s: "error", msg: deps.explain(e) });
    }
    return end({ s: "uncertain", msg: CLAIM_UNCERTAIN_MESSAGE });
  }
  const sent: PendingTx = { ...intent, hash, intent: undefined };
  // one write; if it fails the intent stays saved (a reload resolves it by nonce) and this page holds the hash
  const rep = await pendingStore.replace(attempt, sent, storage);
  // another tab may already have attached this attempt's real hash: follow the entry the comparison returned
  const tracked: PendingTx = rep.current && !rep.current.intent ? rep.current : sent;
  onStep({ s: "pending", hash: tracked.hash });
  try {
    await reconcileSent({ sentTx: deps.sentTx, storage }, tracked).catch(() => tracked);
    const v = await deps.wait(tracked.hash);
    if (v.unverified) return end({ s: "uncertain", msg: v.message ?? CLAIM_UNCERTAIN_MESSAGE });
    pendingStore.removeAttempt(attempt, storage); // this claim attempt only
    return end(v.ok ? { s: "done", hash: v.hash, amount: v.amount ?? 0n } : { s: "error", msg: v.message ?? "The claim did not complete." });
  } catch {
    return end({ s: "uncertain", msg: "Your claim may have been sent, but its receipt could not be read yet. It stays saved and Claim stays off until it settles." });
  }
}

/** Web Locks when the browser has them (all current browsers); otherwise run directly (storage exclusivity still holds). */
export async function webLock<T>(name: string, f: () => Promise<T> | T): Promise<T | "busy"> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks) return f();
  return locks.request(name, { ifAvailable: true }, async (lock) => (lock ? f() : "busy")) as Promise<T | "busy">;
}
