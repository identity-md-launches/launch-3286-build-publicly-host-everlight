import { BaseError, decodeFunctionData, type Hash, type Hex } from "viem";
import { wishGardenAbi } from "../abi/WishGarden";
import { GARDEN } from "../config";
import type { PendingTx } from "./purchase";
import { locateMined, type RecoveryClient } from "./recovery";

/**
 * Durable transaction intents.
 *
 * An intent is saved before a wallet is asked to sign. It names the account, chain (always Ethereum, 1), target (the
 * garden), the sender's nonce read just before signing, the submission block and the exact call (draft for a
 * purchase, claimRewards for a claim). It is cleared only for:
 *  - a proven rejection before submission (EIP-1193 4001 / viem UserRejectedRequestError, or a wagmi pre-flight
 *    error that is thrown before any request reaches the wallet),
 *  - a confirmed cancellation (the user confirms after the chain shows nothing matching is mined or pending), or
 *  - a validated completion (a mined receipt whose transaction is this account calling this exact function).
 * Anything else (4900/4901 disconnects, timeouts, RPC failures, an unknown error) is ambiguous: the wallet may have
 * broadcast the transaction and lost the hash, so the intent stays and the action stays locked.
 */

/** Errors that prove the wallet did not sign or send. Everything else is treated as "may have been sent". */
export function isProvenRejection(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const o = cur as { code?: unknown; name?: unknown; cause?: unknown };
    if (o.code === 4001) return true;
    if (o.name === "UserRejectedRequestError") return true;
    // thrown by wagmi before the provider is asked anything
    if (o.name === "ConnectorNotConnectedError" || o.name === "ChainMismatchError" || o.name === "ConnectorAccountNotFoundError") return true;
    if (o.code === 4900 || o.code === 4901 || o.code === -32603) return false;
    cur = o.cause;
  }
  // a wallet that reports the user's refusal only in words (no code): accepted when nothing else contradicts it
  if (seen.size > 0 && ![...seen].some((x) => typeof (x as { code?: unknown }).code === "number")) {
    const msg = e instanceof BaseError ? `${e.shortMessage} ${e.details ?? ""}` : e instanceof Error ? e.message : "";
    return /\buser (rejected|denied|cancell?ed)\b/i.test(msg);
  }
  return false;
}

/** The placeholder hash an intent is stored under: one per kind and account, so locks are scoped correctly. */
export function intentHash(kind: "buy" | "claim", account: string): Hash {
  const a = account.toLowerCase().replace(/^0x/, "").padStart(40, "0").slice(-40);
  return `0x${kind === "buy" ? "00000000" : "00000001"}${"0".repeat(16)}${a}` as Hash;
}
export const isIntentHash = (h: string) => /^0x0000000[01]0{16}[0-9a-f]{40}$/i.test(h) || /^0x0{64}$/.test(h);

/** A transaction read by its hash (from getTransaction). */
export interface SeenTx { hash: Hash; from: string; to: string | null; input: Hex; nonce: number; chainId?: number }

function callOf(input: Hex): { fn: string; styles?: number[]; wishes?: string[] } | null {
  try {
    const d = decodeFunctionData({ abi: wishGardenAbi, data: input });
    if (d.functionName === "buyCandles") {
      const [s, w] = d.args as unknown as [readonly (number | bigint)[], readonly string[]];
      return { fn: "buyCandles", styles: s.map(Number), wishes: [...w] };
    }
    return { fn: d.functionName };
  } catch {
    return null;
  }
}

/** Does this transaction carry exactly the saved intent: same account, Ethereum, the garden, the same call? */
export function matchesIntent(intent: PendingTx, tx: SeenTx, garden: string = GARDEN): { ok: true } | { ok: false; reason: string } {
  if (tx.from.toLowerCase() !== (intent.from ?? intent.account).toLowerCase()) return { ok: false, reason: "That transaction was sent from a different account." };
  if (tx.chainId !== undefined && tx.chainId !== 1) return { ok: false, reason: "That transaction is not on Ethereum mainnet." };
  if (!tx.to || tx.to.toLowerCase() !== garden.toLowerCase()) return { ok: false, reason: "That transaction was not sent to the Everlight garden contract." };
  if (intent.nonce !== undefined && tx.nonce < intent.nonce) return { ok: false, reason: "That transaction was sent before this action started (its nonce is older)." };
  const c = callOf(tx.input);
  if (intent.kind === "claim") return c?.fn === "claimRewards" ? { ok: true } : { ok: false, reason: "That transaction is not a rewards claim." };
  if (!c || c.fn !== "buyCandles") return { ok: false, reason: "That transaction is not a candle purchase." };
  const s = intent.styles ?? [], w = intent.wishes ?? [];
  const same = c.styles!.length === s.length && c.styles!.every((v, i) => v === s[i]) && c.wishes!.length === w.length && c.wishes!.every((v, i) => v === w[i]);
  return same ? { ok: true } : { ok: false, reason: "That purchase carries different styles or wishes than this draft." };
}

export interface IntentClient extends RecoveryClient {
  /** Count including transactions the node holds as pending. */
  pendingNonce(address: string): Promise<number>;
  tx(hash: Hash): Promise<SeenTx | null>;
}

export type IntentState =
  | { kind: "found"; hash: Hash }
  /** Nothing mined for it yet, and the wallet may still hold or broadcast it. */
  | { kind: "pending" }
  /** Every nonce used since the intent was checked (none is this call) and nothing is pending: the user may release it. */
  | { kind: "not-found"; checked: number }
  | { kind: "unknown"; reason: string };

/** How many consecutive nonces after the saved one are searched (the wallet may have used a later one). */
export const NONCE_SPAN = 8;

/**
 * Resolve an intent without a hash from the sender's nonces: each nonce from the saved one up to the mined count
 * (at most NONCE_SPAN) is located in the bounded block window and the transaction that used it is compared with the
 * intent. Never reports "not-found" while a transaction is pending or a nonce could not be located.
 */
export async function resolveIntent(c: IntentClient, intent: PendingTx, garden: string = GARDEN): Promise<IntentState> {
  const from = intent.from ?? intent.account;
  if (intent.nonce === undefined || intent.block === undefined) return { kind: "unknown", reason: "This action was saved without its nonce." };
  const mined = await c.nonceAt(from);
  const pending = await c.pendingNonce(from);
  if (mined <= intent.nonce) return { kind: "pending" };
  const last = Math.min(mined - 1, intent.nonce + NONCE_SPAN - 1);
  for (let n = intent.nonce; n <= last; n++) {
    const at = await locateMined(c, { ...intent, hash: intent.hash, from, nonce: n });
    if (at.kind !== "mined") return { kind: "unknown", reason: at.kind === "unknown" ? at.reason : "A nonce could not be located." };
    const tx = await c.tx(at.hash);
    if (!tx) return { kind: "unknown", reason: "A transaction from your account could not be read." };
    if (matchesIntent(intent, tx, garden).ok) return { kind: "found", hash: at.hash };
  }
  if (pending > mined) return { kind: "pending" };
  if (mined - 1 > last) return { kind: "unknown", reason: `More than ${NONCE_SPAN} transactions were sent from your account since; paste the transaction hash to reconcile.` };
  return { kind: "not-found", checked: last - intent.nonce + 1 };
}

export const INTENT_NOT_FOUND =
  "None of your account's transactions since this action is a matching garden transaction, and nothing is pending. If your wallet also shows no pending request, you can release it.";
