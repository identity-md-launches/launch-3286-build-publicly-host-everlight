import { encodeFunctionData, type Hash, type Hex } from "viem";
import { wishGardenAbi } from "../abi/WishGarden";
import { burnReceiverAbi } from "../abi/EverlightBurnReceiver";
import { locateMined, type RecoveryClient } from "./recovery";
import { parseImd, type BurnOp, type MinedReceipt } from "./burn";

/**
 * Recovery of saved burn operations after a reload, a lost wallet response or a replacement.
 *
 * Before the wallet is asked, each operation saves its exact request (chain, sender, contract, calldata, value), the
 * sender's pending nonce and the head block. Afterwards it is settled only by evidence tied to that attempt:
 *  - the mined receipt of its own hash, or of the transaction that used the same sender and nonce (a replacement:
 *    a speed-up or a cancel; either way the original can no longer be mined), judged by its events;
 *  - a hash the visitor pastes, accepted only when that transaction carries exactly the saved request;
 *  - for an attempt with no hash: the sender's nonces from the saved one up to the mined count all located and none
 *    carrying the request, with nothing pending (then, and only then, the visitor may release it).
 * Nothing here ever re-sends.
 */

export interface OpRequest { to: string; data: Hex; value: string }
export interface SeenOpTx { hash: Hash; from: string; to: string | null; input: Hex; nonce: number; value: bigint; chainId?: number }
export interface OpClient extends RecoveryClient {
  receipt(hash: Hash): Promise<MinedReceipt | null>;
  pendingNonce(address: string): Promise<number>;
  tx(hash: Hash): Promise<SeenOpTx | null>;
}

const FN = { queue: "queueBurn", dispatch: "dispatchBurn", retry: "retryBurn", receipt: "sendBurnReceipt" } as const;

/** The exact request an operation sends. Older records saved without one are rebuilt from their kind and target. */
export function requestOf(op: BurnOp, garden: string, receiver: string): OpRequest | null {
  if (op.req) return op.req;
  const to = op.chainId === 1 ? garden : receiver;
  const abi: any = op.chainId === 1 ? wishGardenAbi : burnReceiverAbi;
  let args: unknown[];
  if (op.kind === "queue") { const m = parseImd(op.target); if (m === null) return null; args = [m]; }
  else if (op.kind === "dispatch") args = [BigInt(op.target)];
  else args = [op.target as Hash];
  return { to, data: encodeFunctionData({ abi, functionName: FN[op.kind], args } as any), value: op.value ?? "0" };
}

/** Why this transaction is not this operation's request, or null when it is exactly that request. */
export function mismatch(op: BurnOp, tx: SeenOpTx, req: OpRequest | null): string | null {
  if (!req) return "This record has no saved request to compare with.";
  if (tx.chainId !== undefined && tx.chainId !== op.chainId) return `That transaction is not on ${op.chainId === 1 ? "Ethereum" : "Base"}.`;
  if (tx.from.toLowerCase() !== op.account.toLowerCase()) return "That transaction was sent from a different account.";
  if (!tx.to || tx.to.toLowerCase() !== req.to.toLowerCase()) return "That transaction was sent to a different contract.";
  if (tx.input.toLowerCase() !== req.data.toLowerCase()) return "That transaction carries a different call or different arguments.";
  if (tx.value !== BigInt(req.value || "0")) return "That transaction sends a different ETH value.";
  if (op.nonce !== undefined && tx.nonce < op.nonce) return "That transaction was sent before this operation started (its nonce is older).";
  return null;
}

export type OpState =
  | { kind: "mined"; hash: Hash; receipt: MinedReceipt; replaced: boolean }
  /** Not mined yet. `seen` is the sender and nonce read from the sent transaction itself, to be saved. */
  | { kind: "pending"; seen?: { from: string; nonce: number } }
  /** Hashless only: every nonce since the saved one was used by another transaction and nothing is pending. */
  | { kind: "not-found"; checked: number }
  | { kind: "unknown"; reason: string };

/** Nonces after the saved one searched for a hashless attempt (the wallet may have used a later one). */
export const OP_NONCE_SPAN = 8;
/** Blocks after the submission block searched for the transaction that used a nonce. */
export const opWindow = (chainId: 1 | 8453) => (chainId === 1 ? 600n : 3600n);

async function minedAs(c: OpClient, hash: Hash, original?: Hash): Promise<OpState> {
  const r = await c.receipt(hash);
  if (!r) return { kind: "unknown", reason: "The transaction that used this nonce has no readable receipt yet." };
  return { kind: "mined", hash, receipt: r, replaced: !!original && hash.toLowerCase() !== original.toLowerCase() };
}

/** Resolve one saved operation. Read-only. */
export async function locateOp(c: OpClient, op: BurnOp, req: OpRequest | null): Promise<OpState> {
  const window = opWindow(op.chainId);
  if (op.hash) {
    const own = await c.receipt(op.hash);
    if (own) return { kind: "mined", hash: op.hash, receipt: own, replaced: false };
    let from = op.nonceChecked ? op.from : undefined, nonce = op.nonceChecked ? op.nonce : undefined, seen: { from: string; nonce: number } | undefined;
    if (nonce === undefined) {
      const t = await c.tx(op.hash);
      if (t) { from = t.from; nonce = t.nonce; seen = { from, nonce }; }
    }
    if (from !== undefined && nonce !== undefined) {
      if ((await c.nonceAt(from)) <= nonce) return { kind: "pending", seen };
      if (op.block === undefined) return { kind: "unknown", reason: "This record was saved without its submission block." };
      const at = await locateMined(c, { hash: op.hash, kind: "claim", account: op.account, createdAt: op.createdAt, from, nonce, block: op.block }, window);
      if (at.kind === "mined") return minedAs(c, at.hash, op.hash);
      return at.kind === "pending" ? { kind: "pending", seen } : { kind: "unknown", reason: at.reason };
    }
    // the RPC does not know the hash and its nonce was never read: search the sender's nonces for this exact request
    const r = await byNonces(c, op, req);
    return r.kind === "not-found" ? { kind: "unknown", reason: "The RPC does not know this hash and no transaction carrying this request was found. It may have been dropped; it stays saved." } : r;
  }
  return byNonces(c, op, req);
}

async function byNonces(c: OpClient, op: BurnOp, req: OpRequest | null): Promise<OpState> {
  if (op.nonce === undefined || op.block === undefined) return { kind: "unknown", reason: "This record was saved without its nonce. Paste the transaction hash from your wallet to settle it." };
  const mined = await c.nonceAt(op.account);
  const pending = await c.pendingNonce(op.account);
  if (mined <= op.nonce) return { kind: "pending" };
  const last = Math.min(mined - 1, op.nonce + OP_NONCE_SPAN - 1);
  for (let n = op.nonce; n <= last; n++) {
    const at = await locateMined(c, { hash: `0x${"0".repeat(64)}` as Hash, kind: "claim", account: op.account, createdAt: op.createdAt, from: op.account, nonce: n, block: op.block }, opWindow(op.chainId));
    if (at.kind !== "mined") return { kind: "unknown", reason: at.kind === "unknown" ? at.reason : "A nonce could not be located." };
    const t = await c.tx(at.hash);
    if (!t) return { kind: "unknown", reason: "A transaction from your account could not be read." };
    if (!mismatch(op, t, req)) return minedAs(c, at.hash);
  }
  if (pending > mined) return { kind: "pending" };
  if (mined - 1 > last) return { kind: "unknown", reason: `More than ${OP_NONCE_SPAN} transactions were sent from this account since. Paste the transaction hash to settle it.` };
  return { kind: "not-found", checked: last - op.nonce + 1 };
}

/** Verify a pasted hash against the saved request. Returns the verified sender and nonce, or the reason it is refused. */
export async function verifyPasted(c: OpClient, op: BurnOp, req: OpRequest | null, raw: string): Promise<{ ok: true; hash: Hash; from: string; nonce: number } | { ok: false; reason: string }> {
  const h = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return { ok: false, reason: "Enter a transaction hash: 0x followed by 64 hexadecimal characters." };
  const t = await c.tx(h as Hash).catch(() => null);
  if (!t) return { ok: false, reason: `That hash was not found on ${op.chainId === 1 ? "Ethereum" : "Base"}.` };
  const why = mismatch(op, t, req);
  return why ? { ok: false, reason: why } : { ok: true, hash: t.hash, from: t.from, nonce: t.nonce };
}
