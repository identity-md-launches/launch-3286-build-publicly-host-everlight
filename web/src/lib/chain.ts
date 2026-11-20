import type { Hash, TransactionReceipt } from "viem";
import { ethClient } from "../config";
import { INTENT_PENDING_MESSAGE, attemptOf, pendingStore, type PendingTx, type Receipt } from "./purchase";
import { readReceipt, type MinedTx } from "./receipt";
import { locateMined, type RecoveryClient } from "./recovery";
import { INTENT_NOT_FOUND, matchesIntent, resolveIntent, type IntentClient, type SeenTx } from "./intent";

/** Live Ethereum adapter for the bounded replacement search. */
export const recoveryClient: RecoveryClient = {
  receipt: (hash) => ethClient.getTransactionReceipt({ hash }).catch(() => null),
  nonceAt: (address, block) =>
    ethClient.getTransactionCount(block === undefined ? { address: address as Hash, blockTag: "latest" } : { address: address as Hash, blockNumber: block }),
  head: () => ethClient.getBlockNumber(),
  blockTxs: async (block) => {
    const b = await ethClient.getBlock({ blockNumber: block, includeTransactions: true });
    return b.transactions.map((t) => ({ hash: t.hash, from: t.from, nonce: t.nonce }));
  },
};

/** Recovery client plus pending nonces and transactions by hash, for resolving intents saved before signing. */
export const intentClient: IntentClient = {
  ...recoveryClient,
  pendingNonce: (address) => ethClient.getTransactionCount({ address: address as Hash, blockTag: "pending" }),
  tx: async (hash) => {
    try {
      const t = await ethClient.getTransaction({ hash });
      return { hash: t.hash, from: t.from, to: t.to ?? null, input: t.input, nonce: t.nonce, chainId: t.chainId };
    } catch {
      return null;
    }
  },
};

/**
 * Thrown when no matching transaction was found for a saved intent. This is NOT proof of cancellation: the preflight
 * nonce is not the wallet's verified broadcast nonce, and a wallet may have broadcast at a higher or private nonce and
 * then returned an error (e.g. 4900). The attempt stays saved; the UI offers check-again and hash recovery.
 */
export class IntentNotFoundError extends Error {
  constructor() { super(INTENT_NOT_FOUND); }
}

/**
 * Reconcile a saved intent with a transaction hash the user pasted from their wallet: the transaction must exist on
 * Ethereum and be this account calling the same garden function with the same draft at or after the saved nonce.
 * On success the intent is replaced by the hash (verified sender and nonce) and recovery follows its receipt.
 */
export async function attachHash(intent: PendingTx, hash: string, client: Pick<IntentClient, "tx"> = intentClient, storage?: Storage | null): Promise<{ ok: true; tx: PendingTx } | { ok: false; reason: string }> {
  const h = hash.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return { ok: false, reason: "A transaction hash is 0x followed by 64 hexadecimal characters." };
  let t: SeenTx | null;
  try { t = await client.tx(h as Hash); } catch { t = null; }
  if (!t) return { ok: false, reason: "That transaction was not found on Ethereum (yet). Check the hash, or wait a moment and try again." };
  const m = matchesIntent(intent, t);
  if (!m.ok) return m;
  const attempt = attemptOf(intent);
  const next: PendingTx = { ...intent, attempt, hash: t.hash, intent: undefined, from: t.from, nonce: t.nonce, nonceChecked: true };
  // the same attempt now carries the real hash; the caller checks this returned entry at once (not the placeholder)
  pendingStore.replace(attempt, next, storage);
  return { ok: true, tx: next };
}

export async function minedTx(hash: Hash): Promise<MinedTx | null> {
  try {
    const t = await ethClient.getTransaction({ hash });
    return { from: t.from, to: t.to ?? null, input: t.input, nonce: t.nonce };
  } catch {
    return null;
  }
}

/**
 * The mined receipt for a saved transaction, following replacements. The saved sender and nonce are used for the
 * bounded replacement search only once they were verified against the submitted transaction itself (nonceChecked):
 * a preflight nonce read before signing may not be the one the wallet used, so a transaction found at that nonce
 * could be unrelated. Until the metadata is verified, only the sent hash's own receipt counts (viem follows a
 * replacement only after reading the sent transaction by its hash). Throws when nothing verifiable is mined within
 * `timeout`, so the caller keeps the hash, its exact draft and its submission block saved and retryable.
 */
export async function settleReceipt(hash: Hash, tx?: PendingTx, timeout = 10 * 60_000): Promise<{ receipt: TransactionReceipt; mined: MinedTx | null }> {
  let target = hash;
  if (tx?.intent) {
    // a recovery intent saved before signing: no hash is known, so the purchase is found from the sender's nonce
    // (its calldata and events are then checked against the saved draft before anything counts as lit)
    const at = await resolveIntent(intentClient, tx);
    if (at.kind === "pending") throw new Error(INTENT_PENDING_MESSAGE);
    if (at.kind === "not-found") throw new IntentNotFoundError();
    if (at.kind === "unknown") throw new Error(at.reason);
    const receipt = await ethClient.getTransactionReceipt({ hash: at.hash });
    return { receipt, mined: await minedTx(receipt.transactionHash) };
  }
  if (tx) tx = await completeMeta(tx);
  if (tx && verifiedMeta(tx)) {
    const at = await locateMined(recoveryClient, tx);
    if (at.kind === "unknown") throw new Error(at.reason);
    if (at.kind === "mined") target = at.hash;
  }
  const receipt = target !== hash
    ? await ethClient.getTransactionReceipt({ hash: target })
    : await ethClient.waitForTransactionReceipt({ hash, timeout }).catch((e) => {
      if (tx && !verifiedMeta(tx)) throw new Error(NONCE_UNVERIFIED);
      throw e;
    });
  return { receipt, mined: await minedTx(receipt.transactionHash) };
}

/** Sender, nonce and submission block are all present and the nonce was read from the sent transaction itself. */
export const verifiedMeta = (tx: PendingTx) => tx.nonceChecked === true && !!tx.from && tx.nonce !== undefined && tx.block !== undefined;

export const NONCE_UNVERIFIED =
  "Your wallet's transaction could not be read yet, so the nonce it used is not verified and a replacement cannot be searched for safely. It stays saved with its exact draft and submission block; check again in a moment.";

/** settleReceipt, read into the purchase flow's Receipt (events plus decoded calldata). */
export async function settleBuyReceipt(hash: Hash, tx?: PendingTx): Promise<Receipt> {
  const { receipt, mined } = await settleReceipt(hash, tx);
  return readReceipt(receipt, mined ?? undefined);
}

/** Sender nonce (pending) and the current block, read just before a transaction is requested. */
export async function submissionMeta(address: string): Promise<{ nonce: number; block: bigint }> {
  const [nonce, block] = await Promise.all([
    ethClient.getTransactionCount({ address: address as Hash, blockTag: "pending" }),
    ethClient.getBlockNumber(),
  ]);
  return { nonce, block };
}

/** The submitted transaction's own sender and nonce, read by its hash (null while the node does not know it). */
export async function sentTx(hash: Hash): Promise<{ from: string; nonce: number } | null> {
  try {
    const t = await ethClient.getTransaction({ hash });
    return { from: t.from, nonce: t.nonce };
  } catch {
    return null;
  }
}

/**
 * Before a recovery search, complete a saved transaction's metadata: reconcile a preflight (or missing) nonce with
 * the sent transaction itself when the node still knows its hash, and give an entry saved without a submission
 * block a conservative one from its save time (12 s blocks, 25 blocks of slack). Updates the saved entry.
 */
export async function completeMeta(tx: PendingTx): Promise<PendingTx> {
  let next = tx;
  if (!tx.nonceChecked || tx.nonce === undefined) {
    const got = await sentTx(tx.hash);
    if (got) next = { ...next, from: got.from, nonce: got.nonce, nonceChecked: true };
  }
  if (next.from === undefined) next = { ...next, from: tx.account };
  if (next.block === undefined) {
    const head = await ethClient.getBlockNumber();
    const ago = BigInt(Math.ceil(Math.max(0, Date.now() - tx.createdAt) / 12_000) + 25);
    next = { ...next, block: (head > ago ? head - ago : 0n).toString() };
  }
  if (next !== tx) pendingStore.update(attemptOf(tx), () => next, undefined, tx.hash); // compare-and-update
  return next;
}

export type CancelCheck = { ok: true; tx: PendingTx } | { ok: false; reason: string };

/** The saved entry for exactly this attempt (same placeholder or hash, account, start time and nonce), if still saved. */
export function savedAttempt(tx: PendingTx, storage?: Storage | null): PendingTx | null {
  return pendingStore.get(attemptOf(tx), storage);
}

/**
 * Cancellation of an attempt WITHOUT a known hash is never inferred from nonces: the saved nonce was read before
 * signing, so an unrelated transaction consuming it says nothing about this attempt, and a wallet may have broadcast
 * it at a higher or private nonce before failing (4900). Release needs evidence tied to the submitted transaction
 * itself: its hash (pasted, or found as a matching garden call), whose receipt then settles it. Until then this always
 * answers "stays locked" with the reason.
 */
export async function verifyCancelled(tx: PendingTx, client: IntentClient = intentClient): Promise<CancelCheck> {
  if (!tx.intent) return { ok: false, reason: "This transaction's hash is known, so it is settled from its receipt: use Check again. A cancellation in your wallet is recognised there." };
  let at: Awaited<ReturnType<typeof resolveIntent>>;
  try {
    at = await resolveIntent(client, tx);
  } catch {
    return { ok: false, reason: "Your account's transactions could not be read from Ethereum. It stays locked; try again in a moment." };
  }
  if (at.kind === "found") return { ok: false, reason: "A matching transaction was mined from your account, so this was sent. Use Check again to follow its receipt." };
  if (at.kind === "not-found") return { ok: false, reason: INTENT_NOT_FOUND };
  if (at.kind === "pending") return { ok: false, reason: INTENT_PENDING_MESSAGE };
  return { ok: false, reason: `${at.reason} It stays locked.` };
}

/** Kept for callers of earlier builds: an attempt without hash evidence is never released (see verifyCancelled). */
export async function releaseVerified(tx: PendingTx, remove: (t: PendingTx) => void, client: IntentClient = intentClient, storage?: Storage | null): Promise<CancelCheck> {
  const cur = savedAttempt(tx, storage);
  if (!cur) return { ok: false, reason: "This attempt is no longer saved in this browser (another tab may have settled it)." };
  const v = await verifyCancelled(cur, client);
  if (v.ok && savedAttempt(cur, storage)) remove(cur);
  return v;
}
