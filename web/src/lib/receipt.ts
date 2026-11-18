import { decodeFunctionData, parseEventLogs, toFunctionSelector, type Hash, type Hex, type Log } from "viem";
import { wishGardenAbi } from "../abi/WishGarden";
import { GARDEN } from "../config";
import type { Receipt } from "./purchase";

/** The mined transaction itself (sender, target and calldata), read with getTransaction on the mined hash. */
export interface MinedTx { from: string; to: string | null; input: Hex; nonce?: number }

/** Decode buyCandles(styles, wishes) calldata; null for anything else (a cancel, a self-transfer, another call). */
export function decodeBuy(input: Hex | undefined): { styles: number[]; wishes: string[] } | null {
  if (!input || input === "0x") return null;
  try {
    const d = decodeFunctionData({ abi: wishGardenAbi, data: input });
    if (d.functionName !== "buyCandles") return null;
    const [styles, wishes] = d.args as unknown as [readonly (number | bigint)[], readonly string[]];
    return { styles: styles.map(Number), wishes: [...wishes] };
  } catch {
    return null;
  }
}

/**
 * Turn a mined receipt into the purchase flow's Receipt: its status, its own transactionHash (which is the
 * replacement's when a wallet sped the purchase up), the garden's CandlesPurchased event, every CandleCreated
 * event and, when the mined transaction is passed, its sender, target and decoded buyCandles calldata.
 * Events with the same signatures from any other address are ignored.
 */
export function readReceipt(r: { status: "success" | "reverted"; transactionHash: Hash; logs: Log[] }, tx?: MinedTx): Receipt {
  const garden = GARDEN.toLowerCase();
  const own = r.logs.filter((l) => l.address?.toLowerCase() === garden);
  const ev = parseEventLogs({ abi: wishGardenAbi, logs: own, eventName: "CandlesPurchased" })[0];
  const created = parseEventLogs({ abi: wishGardenAbi, logs: own, eventName: "CandleCreated" }).map((e) => ({
    id: Number(e.args.candleId), purchaser: e.args.purchaser as string, style: Number(e.args.style), wish: e.args.wish as string,
  }));
  const out: Receipt = {
    status: r.status,
    hash: r.transactionHash,
    purchase: ev ? { purchaser: ev.args.purchaser, firstId: Number(ev.args.firstCandleId), quantity: Number(ev.args.quantity) } : null,
    created,
  };
  if (tx) {
    out.from = tx.from;
    out.to = tx.to;
    out.call = decodeBuy(tx.input);
  }
  return out;
}

const CLAIM_SELECTOR = toFunctionSelector("function claimRewards()");

export type ClaimVerdict = { ok: true; amount: bigint } | { ok: false; message: string };
export const CLAIM_REPLACED =
  "This claim was cancelled or replaced in your wallet, so nothing was claimed. Your rewards are still claimable.";

/**
 * A claim counts only when the mined transaction (possibly a replacement) succeeded, was sent by this account to
 * the garden with claimRewards() calldata, and the garden itself emitted RewardsClaimed for this account.
 * A cancel or self-transfer replacement has none of these and is never reported as Claimed.
 */
export function settleClaim(
  r: { status: "success" | "reverted"; logs: Log[] },
  tx: MinedTx | null,
  account: string,
): ClaimVerdict {
  if (r.status !== "success") return { ok: false, message: "The claim reverted onchain. Only gas was spent." };
  const garden = GARDEN.toLowerCase();
  if (!tx || tx.to?.toLowerCase() !== garden || tx.from.toLowerCase() !== account.toLowerCase() || !tx.input.toLowerCase().startsWith(CLAIM_SELECTOR)) {
    return { ok: false, message: CLAIM_REPLACED };
  }
  const ev = parseEventLogs({ abi: wishGardenAbi, logs: r.logs.filter((l) => l.address?.toLowerCase() === garden), eventName: "RewardsClaimed" })
    .find((e) => (e.args as { beneficiary: string }).beneficiary.toLowerCase() === account.toLowerCase());
  if (!ev) return { ok: false, message: CLAIM_REPLACED };
  return { ok: true, amount: (ev.args as { amount: bigint }).amount };
}
