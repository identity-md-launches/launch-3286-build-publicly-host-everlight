import type { Hash } from "viem";
import { intentHash, isProvenRejection } from "./intent";
import { WALLET_CHANGED_MESSAGE, attemptOf, newAttemptId, pendingStore, reconcileSent, walletStillBound, type PendingTx, type WalletState } from "./purchase";

/**
 * Manual reward claim with a durable intent. Order (the fix for "claims sent before an intent was recorded"):
 *  1. no saved or uncertain claim for this account (any tab) — otherwise no second claim is offered;
 *  2. storage preflight — if this browser cannot save, nothing is sent;
 *  3. simulate, then read the sender's nonce and the submission block;
 *  4. persist the claim intent (exclusive per account across tabs, read back) BEFORE the wallet is asked;
 *  5. send; a proven rejection releases the intent, anything else keeps it (the wallet may have broadcast);
 *  6. replace the intent with the hash (a failed write keeps the intent saved), then settle from the receipt.
 */
export type ClaimStep =
  | { s: "idle" }
  | { s: "wallet" }
  | { s: "pending"; hash: Hash }
  /** The claim may have been sent: the intent stays saved and Claim stays off until it is reconciled. */
  | { s: "uncertain"; msg: string }
  | { s: "done"; hash: Hash; amount: bigint }
  | { s: "error"; msg: string };

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
}

export const CLAIM_STORAGE_MESSAGE =
  "This browser is not letting the site save recovery data (storage is full or blocked), so a claim could not be recovered after a reload. Nothing was sent. Free some site storage or leave private mode, then try again.";
export const CLAIM_BUSY_MESSAGE = "A claim for this wallet is already in progress in this or another tab. Nothing new was sent.";
export const CLAIM_UNCERTAIN_MESSAGE =
  "Your wallet stopped answering before it returned a transaction hash, so this claim may have been sent. It stays saved and Claim stays off so the same rewards are not requested twice. Check again, or paste the hash from your wallet's activity.";

export const claimConflict = (account: string) => (t: PendingTx) => t.kind === "claim" && t.account.toLowerCase() === account.toLowerCase();

export async function runClaim(deps: ClaimDeps, onStep: (s: ClaimStep) => void): Promise<ClaimStep> {
  const end = (s: ClaimStep) => { onStep(s); return s; };
  const { account, storage } = deps;
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
    from: account, nonce: sub.nonce, block: sub.block.toString(), nonceChecked: false, attempt: (deps.newAttempt ?? newAttemptId)(),
  };
  const attempt = attemptOf(intent);
  const write = () => pendingStore.persistExclusive(intent, conflict, storage);
  const saved = deps.withLock ? await deps.withLock(`everlight-claim-${account.toLowerCase()}`, write) : write();
  if (saved === "busy" || saved === "conflict") return end({ s: "error", msg: CLAIM_BUSY_MESSAGE });
  if (saved !== "saved") return end({ s: "error", msg: CLAIM_STORAGE_MESSAGE });

  if (deps.walletState && !(await walletStillBound(account, deps.walletState))) {
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
  pendingStore.replace(attempt, sent, storage);
  onStep({ s: "pending", hash });
  try {
    await reconcileSent({ sentTx: deps.sentTx, storage }, sent).catch(() => sent);
    const v = await deps.wait(hash);
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
