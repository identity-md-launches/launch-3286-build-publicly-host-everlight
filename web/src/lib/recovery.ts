import type { Hash } from "viem";
import type { PendingTx } from "./purchase";

/** Default recovery window after the submission block: about 2 hours of Ethereum blocks. */
export const RECOVERY_BLOCKS = 600n;

export interface RecoveryClient {
  /** Resolves with the receipt, or null when the hash has none (pending, dropped or replaced). */
  receipt(hash: Hash): Promise<unknown | null>;
  /** Mined nonce count of an address, at the latest block or a given block. */
  nonceAt(address: string, block?: bigint): Promise<number>;
  head(): Promise<bigint>;
  /** Transactions of one block (hash, sender, nonce). */
  blockTxs(block: bigint): Promise<{ hash: Hash; from: string; nonce: number }[]>;
}

export type Located =
  | { kind: "mined"; hash: Hash; replaced: boolean }
  | { kind: "pending" }
  /** The nonce was used by a transaction outside the bounded window, or the window could not be read. */
  | { kind: "unknown"; reason: string };

/**
 * Find the transaction that consumed a sent transaction's (sender, nonce) after a reload, in a bounded window
 * from its submission block. 1) the sent hash's own receipt; 2) if the sender's mined nonce has not passed it,
 * it is still pending; 3) otherwise binary-search the block where the nonce count passed it (historical nonce
 * reads), falling back to a linear scan of at most `window` blocks, and return the replacement's hash.
 */
export async function locateMined(c: RecoveryClient, tx: PendingTx, window = RECOVERY_BLOCKS): Promise<Located> {
  if (await c.receipt(tx.hash)) return { kind: "mined", hash: tx.hash, replaced: false };
  if (!tx.from || tx.nonce === undefined || tx.block === undefined) return { kind: "unknown", reason: "This transaction was saved without its sender and nonce." };
  const from = tx.from.toLowerCase();
  if ((await c.nonceAt(tx.from)) <= tx.nonce) return { kind: "pending" };
  const start = BigInt(tx.block);
  const head = await c.head();
  const end = head < start + window ? head : start + window;
  let lo = start, hi = end, found: bigint | null = null;
  try {
    // smallest block whose post-state nonce count exceeds the nonce = the block that mined it
    if ((await c.nonceAt(tx.from, hi)) <= tx.nonce) return { kind: "unknown", reason: "The nonce was used after the recovery window." };
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if ((await c.nonceAt(tx.from, mid)) > tx.nonce) hi = mid; else lo = mid + 1n;
    }
    found = lo;
  } catch {
    found = null; // a node without historical state: scan the window instead
  }
  const scan = found !== null ? [found] : Array.from({ length: Number(end - start) + 1 }, (_, i) => start + BigInt(i));
  for (let i = 0; i < scan.length; i += 8) {
    const batch = await Promise.all(scan.slice(i, i + 8).map((b) => c.blockTxs(b).catch(() => [])));
    for (const txs of batch) {
      const hit = txs.find((t) => t.from.toLowerCase() === from && t.nonce === tx.nonce);
      if (hit) return { kind: "mined", hash: hit.hash, replaced: hit.hash.toLowerCase() !== tx.hash.toLowerCase() };
    }
  }
  return { kind: "unknown", reason: "The replacement transaction was not found within the recovery window." };
}
