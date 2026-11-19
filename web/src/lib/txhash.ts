import { parseAbiItem } from "viem";
import { GARDEN, GARDEN_DEPLOY_BLOCK } from "../config";
import type { Candle } from "./candles";

export type Hash = `0x${string}`;
export const CANDLES_PURCHASED = parseAbiItem(
  "event CandlesPurchased(address indexed purchaser, uint256 indexed firstCandleId, uint256 quantity, uint256 totalIMD)",
);

/** Candle id -> hash of the transaction that lit it, from CandlesPurchased logs (receipts, activity reads, lookups). */
const KEY = `everlight:v2:tx:${GARDEN.toLowerCase()}`;
let memo: Record<string, Hash> | null = null;
function table(): Record<string, Hash> {
  if (memo) return memo;
  try { memo = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { memo = {}; }
  return memo!;
}

/** Record that candles firstId .. firstId + count - 1 were lit by transaction `hash`. */
export function rememberTx(firstId: number, count: number, hash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash) || !(firstId >= 1) || !(count >= 1) || count > 50) return;
  const t = table();
  for (let id = firstId; id < firstId + count; id++) t[id] = hash as Hash;
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* quota or private mode: memory only */ }
}
export function knownTx(id: number): Hash | null {
  return table()[id] ?? null;
}

interface LogLike { transactionHash: string | null; args: { firstCandleId?: bigint; quantity?: bigint } }
export interface TxClient {
  getBlock(args?: { blockNumber: bigint }): Promise<{ number: bigint | null; timestamp: bigint }>;
  getLogs(args: { address: string; event: typeof CANDLES_PURCHASED; args: { purchaser: string }; fromBlock: bigint; toBlock: bigint }): Promise<LogLike[]>;
}

/**
 * The transaction that lit candle c. Its record's createdAt is the timestamp of the purchase block, so the block
 * is found by interpolating on timestamps (a few getBlock reads), then the purchaser's CandlesPurchased logs in a
 * small window around it are matched on firstCandleId <= id < firstCandleId + quantity. A wider window is
 * tried once before giving up. Returns null when no matching log is found.
 */
export async function findCandleTx(client: TxClient, c: Candle): Promise<Hash | null> {
  const cached = knownTx(c.id);
  if (cached) return cached;
  const head = await client.getBlock();
  const hi = head.number ?? 0n, lo = GARDEN_DEPLOY_BLOCK;
  const clamp = (b: bigint) => (b < lo ? lo : b > hi ? hi : b);
  let guess = clamp(hi - BigInt(Math.max(0, Math.round((Number(head.timestamp) - c.createdAt) / 12))));
  for (let i = 0; i < 6; i++) {
    const b = await client.getBlock({ blockNumber: guess });
    const dt = c.createdAt - Number(b.timestamp);
    if (dt === 0) break;
    const step = BigInt(Math.round(dt / 12)) || (dt > 0 ? 1n : -1n);
    const next = clamp(guess + step);
    if (next === guess) break;
    guess = next;
  }
  for (const span of [40n, 1200n]) {
    const logs = await client.getLogs({
      address: GARDEN, event: CANDLES_PURCHASED, args: { purchaser: c.purchaser }, fromBlock: clamp(guess - span), toBlock: clamp(guess + span),
    });
    for (const l of logs) {
      const first = Number(l.args.firstCandleId ?? 0n), q = Number(l.args.quantity ?? 0n);
      if (l.transactionHash) rememberTx(first, q, l.transactionHash);
      if (l.transactionHash && c.id >= first && c.id < first + q) return l.transactionHash as Hash;
    }
  }
  return null;
}
