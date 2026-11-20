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
