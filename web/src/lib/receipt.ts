import { parseEventLogs, type Hash, type Log } from "viem";
import { wishGardenAbi } from "../abi/WishGarden";
import { GARDEN } from "../config";
import type { Receipt } from "./purchase";

/**
 * Turn a mined receipt into the purchase flow's Receipt: its status, its own transactionHash (which is the
 * replacement's when a wallet sped the purchase up) and the CandlesPurchased event emitted by the garden
 * contract itself. Events with the same signature from any other address are ignored.
 */
export function readReceipt(r: { status: "success" | "reverted"; transactionHash: Hash; logs: Log[] }): Receipt {
  const garden = GARDEN.toLowerCase();
  const ev = parseEventLogs({ abi: wishGardenAbi, logs: r.logs.filter((l) => l.address?.toLowerCase() === garden), eventName: "CandlesPurchased" })[0];
  return {
    status: r.status,
    hash: r.transactionHash,
    purchase: ev ? { purchaser: ev.args.purchaser, firstId: Number(ev.args.firstCandleId), quantity: Number(ev.args.quantity) } : null,
  };
}
