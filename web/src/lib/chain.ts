import type { Hash, TransactionReceipt } from "viem";
import { ethClient } from "../config";
import type { PendingTx, Receipt } from "./purchase";
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
 * The mined receipt for a saved transaction, following replacements. With the saved sender, nonce and
 * submission block it first locates the transaction that consumed that nonce (bounded window), so a purchase
 * sped up or cancelled while the tab was closed is still found after a reload. Throws when nothing is mined yet
 * within `timeout` or the replacement cannot be located, so the caller keeps the transaction pending.
 */
export async function settleReceipt(hash: Hash, tx?: PendingTx, timeout = 10 * 60_000): Promise<{ receipt: TransactionReceipt; mined: MinedTx | null }> {
  let target = hash;
  if (tx?.from && tx.nonce !== undefined && tx.block !== undefined) {
    const at = await locateMined(recoveryClient, tx);
    if (at.kind === "unknown") throw new Error(at.reason);
    if (at.kind === "mined") target = at.hash;
  }
  const receipt = target !== hash
    ? await ethClient.getTransactionReceipt({ hash: target })
    : await ethClient.waitForTransactionReceipt({ hash, timeout });
  return { receipt, mined: await minedTx(receipt.transactionHash) };
}

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
