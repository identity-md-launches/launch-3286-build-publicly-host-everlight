import type { Hash, TransactionReceipt } from "viem";
import { ethClient } from "../config";
import { pendingStore, type PendingTx, type Receipt } from "./purchase";
import { readReceipt, type MinedTx } from "./receipt";
import { locateMined, type RecoveryClient } from "./recovery";

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
  if (next !== tx && pendingStore.list().some((t) => t.hash === tx.hash)) pendingStore.add(next);
  return next;
}
