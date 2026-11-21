import { decodeEventLog, type Hash, type Log } from "viem";
import { wishGardenAbi } from "../abi/WishGarden";
import { burnReceiverAbi } from "../abi/EverlightBurnReceiver";

/**
 * Burn accounting for the live garden (Ethereum) and its Base burn receiver. Pure functions only: every read is passed
 * in, so the rules are unit-tested without a network. Source: launch-3312 EverlightBridgeQueue.sol and
 * EverlightBurnReceiver.sol at 5752e230.
 *
 * Ethereum: purchases add to totalBurnAllocated and burnQueued. queueBurn moves a bridge-precision amount
 * burnQueued -> burnReserved (one job). dispatchBurn moves burnReserved -> burnInTransit, or, when the bridge send is
 * caught, leaves it reserved with status Failed (failedBurnAmount is a SUBSET of burnReserved). A Base receipt moves
 * burnInTransit -> confirmedBurn. Invariant: totalBurnAllocated = burnQueued + burnReserved + burnInTransit + confirmedBurn.
 *
 * Base: a delivery adds to totalReceived and pendingBurn, then the receiver burns it: pendingBurn -> totalBurned.
 * A failed burn stays in pendingBurn (failedBurn is a SUBSET of pendingBurn). Invariant: totalReceived = pendingBurn +
 * totalBurned.
 *
 * "IMD burned" is Base totalBurned only. confirmedBurn describes the same burns seen from Ethereum, so it is never
 * added to totalBurned; burnInTransit and Base pendingBurn can describe the same tokens, so they are never summed.
 */

/** OFT shared-decimal conversion (IMDBridge.CONVERSION_RATE): 18 local decimals, 6 shared decimals. */
export const CONVERSION_RATE = 10n ** 12n;
/** Fee ceiling both contracts enforce (MAX_NATIVE_FEE). */
export const MAX_NATIVE_FEE = 5n * 10n ** 16n;
/** dispatchBurn reverts below SEND_GAS * 64 / 63 + 150_000 gas left; the site sends at least this limit. */
export const DISPATCH_MIN_GAS = 1_500_000n;
/** _attemptBurn reverts below BURN_GAS * 64 / 63 + 120_000 gas left (BURN_GAS 150,000); the site sends at least this. */
export const RETRY_MIN_GAS = 450_000n;
/** A snapshot older than this (block time or last successful read) is labelled stale. */
export const STALE_MS = 3 * 60_000;
/** Footer polling interval: modest, public RPCs only. */
export const POLL_MS = 60_000;

export interface EthSnap {
  block: bigint; ts: number; readAt: number;
  totalBurnAllocated: bigint; burnQueued: bigint; burnReserved: bigint; burnInTransit: bigint; confirmedBurn: bigint;
  failedBurnAmount: bigint; burnJobCount: bigint; bridgeDust: bigint;
  owner: string; activated: boolean; baseReady: boolean;
}
export interface BaseSnap {
  block: bigint; ts: number; readAt: number;
  totalReceived: bigint; pendingBurn: bigint; failedBurn: bigint; totalBurned: bigint; activated: boolean; owner: string;
}

/** Checks inside one chain's snapshot (all values read at the same block). */
export function checkEth(e: EthSnap): string[] {
  const out: string[] = [];
  if (e.totalBurnAllocated !== e.burnQueued + e.burnReserved + e.burnInTransit + e.confirmedBurn)
    out.push("Ethereum: allocation does not equal unqueued + reserved + in transit + confirmed.");
  if (e.failedBurnAmount > e.burnReserved) out.push("Ethereum: failed sends exceed reserved jobs.");
  if (e.bridgeDust !== e.burnQueued % CONVERSION_RATE) out.push("Ethereum: bridge dust does not match the unqueued balance.");
  return out;
}
export function checkBase(b: BaseSnap): string[] {
  const out: string[] = [];
  if (b.totalReceived !== b.pendingBurn + b.totalBurned) out.push("Base: received does not equal pending + burned.");
  if (b.failedBurn > b.pendingBurn) out.push("Base: failed burns exceed pending burns.");
  return out;
}
/** Cross-chain checks. A failure here usually means one chain's read is behind the other: re-read both. */
export function checkCross(e: EthSnap, b: BaseSnap): string[] {
  const out: string[] = [];
  if (b.totalBurned > e.totalBurnAllocated) out.push("Base burned more than Ethereum has allocated.");
  if (e.confirmedBurn > b.totalBurned) out.push("Ethereum confirmed more than Base has burned.");
  if (b.totalReceived > e.burnInTransit + e.confirmedBurn) out.push("Base received more than Ethereum has dispatched.");
  return out;
}

export type Health = "ok" | "inconsistent" | "partial" | "unavailable";
export interface Reconciled {
  health: Health;
  issues: string[];
  /** Base totalBurned; undefined when Base was not read or is internally inconsistent. */
  burned?: bigint;
  /** totalBurnAllocated - totalBurned; undefined unless both chains are read and consistent. Never clamped. */
  pending?: bigint;
  /** Burned on Base but not yet acknowledged on Ethereum: totalBurned - confirmedBurn. */
  unacknowledgedBurned?: bigint;
  /** Dispatched and not yet burned on Base (in flight, or pending/failed there): burnInTransit - unacknowledgedBurned. */
  inTransitUnburned?: bigint;
  eth?: EthSnap;
  base?: BaseSnap;
}

/** Combine two snapshots. Any failed check makes the dependent figure undefined (shown Unavailable), never zero. */
export function reconcile(e: EthSnap | null, b: BaseSnap | null): Reconciled {
  const ei = e ? checkEth(e) : [], bi = b ? checkBase(b) : [];
  const issues = [...ei, ...bi];
  const r: Reconciled = { health: "ok", issues, eth: e ?? undefined, base: b ?? undefined };
  if (b && bi.length === 0) r.burned = b.totalBurned;
  if (!e || !b) {
    r.health = !e && !b ? "unavailable" : "partial";
    if (!e) issues.push("Ethereum could not be read.");
    if (!b) issues.push("Base could not be read.");
    if (issues.length > (e ? 0 : 1) + (b ? 0 : 1)) r.health = "inconsistent";
    return r;
  }
  const ci = ei.length || bi.length ? [] : checkCross(e, b);
  issues.push(...ci);
  if (issues.length) { r.health = "inconsistent"; return r; }
  r.pending = e.totalBurnAllocated - b.totalBurned;
  r.unacknowledgedBurned = b.totalBurned - e.confirmedBurn;
  r.inTransitUnburned = e.burnInTransit - r.unacknowledgedBurned;
  if (r.pending < 0n || r.unacknowledgedBurned < 0n || r.inTransitUnburned < 0n) {
    // impossible with consistent reads; never clamp
    r.pending = r.unacknowledgedBurned = r.inTransitUnburned = undefined;
    r.health = "inconsistent";
    issues.push("A derived balance is negative.");
  }
  return r;
}

/**
 * Read both chains, retrying while the cross-chain checks fail (one RPC behind the other). Returns the last attempt's
 * reconciliation with how many attempts were made. Each attempt re-reads BOTH chains at their latest blocks.
 */
export async function readConsistent(
  readEth: () => Promise<EthSnap>, readBase: () => Promise<BaseSnap>, attempts = 3, pause = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<Reconciled & { attempts: number }> {
  let last: Reconciled = reconcile(null, null);
  for (let i = 1; i <= attempts; i++) {
    const [e, b] = await Promise.all([readEth().catch(() => null), readBase().catch(() => null)]);
    last = reconcile(e, b);
    if (last.health === "ok") return { ...last, attempts: i };
    if (i < attempts) await pause(1500 * i);
  }
  return { ...last, attempts };
}

export function isStale(snapTs: number | undefined, readAt: number | undefined, now = Date.now()): boolean {
  if (!snapTs || !readAt) return true;
  return now - snapTs * 1000 > STALE_MS || now - readAt > STALE_MS;
}

/** queueBurn's own rounding: min(maximum, burnQueued) floored to bridge precision. */
export function planQueue(burnQueued: bigint, maximum: bigint) {
  const capped = maximum < burnQueued ? maximum : burnQueued;
  const amount = (capped / CONVERSION_RATE) * CONVERSION_RATE;
  return { amount, dust: capped - amount, remaining: burnQueued - amount, ok: amount > 0n && amount / CONVERSION_RATE <= 2n ** 64n - 1n };
}

/** Parse a decimal IMD amount to integer token units (18 decimals). Never via floating point. */
export function parseImd(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d+(\.\d{0,18})?$/.test(t)) return null;
  const [i, f = ""] = t.split(".");
  return BigInt(i) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18) || "0");
}

export const JOB_STATUS = ["None", "Queued", "Failed", "InTransit", "Completed"] as const;
export const DELIVERY_STATUS = ["None", "Received", "Failed", "Burned"] as const;
export interface Job { id: number; amount: bigint; guid: Hash; attempts: number; status: number }
export interface Delivery { jobId: bigint; amount: bigint; attempts: number; status: number; acknowledged: boolean }
export const ZERO32 = `0x${"0".repeat(64)}` as Hash;

export const jobLabel = (s: number) =>
  ["Unknown", "Reserved, not sent", "Send failed (reserved, retryable)", "Dispatched, unacknowledged", "Confirmed on Ethereum"][s] ?? "Unknown";
export const deliveryLabel = (d: Delivery | null | undefined) => {
  if (d === undefined) return "Unavailable";
  if (d === null || d.status === 0) return "Not delivered to Base";
  if (d.status === 1) return "Received, burn pending";
  if (d.status === 2) return "Burn failed (retryable by anyone)";
  return d.acknowledged ? "Burned · confirmation sent" : "Burned · confirmation not sent";
};

/** Cross-check one Ethereum job against the Base delivery stored under its GUID and Base's jobGuids(jobId). */
export function crossCheck(job: Job, jobGuidOnBase: Hash | undefined, d: Delivery | null | undefined): { ok: boolean; note: string } {
  if (job.guid === ZERO32) {
    if (jobGuidOnBase && jobGuidOnBase !== ZERO32) return { ok: false, note: "Base recorded a delivery for this job, but Ethereum has no GUID for it." };
    return { ok: true, note: "Not sent yet: no GUID." };
  }
  if (d === undefined || jobGuidOnBase === undefined) return { ok: false, note: "Base could not be read for this job." };
  if (d === null || d.status === 0) {
    if (jobGuidOnBase !== ZERO32) return { ok: false, note: "Base recorded a different GUID for this job." };
    return { ok: true, note: job.status === 4 ? "Confirmed on Ethereum but not found on Base." : "In flight: not delivered to Base yet." };
  }
  if (d.jobId !== BigInt(job.id) || d.amount !== job.amount || jobGuidOnBase.toLowerCase() !== job.guid.toLowerCase())
    return { ok: false, note: "Base delivery does not match this job's ID, amount or GUID." };
  if (job.status === 4 && !(d.status === 3 && d.acknowledged)) return { ok: false, note: "Ethereum confirmed a burn Base has not acknowledged." };
  return { ok: true, note: "Base delivery matches this job." };
}

/** The ID range shown on one page, newest first. burnJobCount is a historical count of jobs created, not pending jobs. */
export function jobPage(count: number, page: number, size: number): number[] {
  const hi = count - page * size;
  const out: number[] = [];
  for (let id = hi; id > Math.max(0, hi - size); id--) out.push(id);
  return out;
}

// ---------- eligibility (checked before every write, from fresh reads) ----------
export interface WalletCtx { account?: string; chainId?: number }
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function queueEligibility(w: WalletCtx, e: EthSnap | undefined, maximum: bigint | null, busy: boolean): string | null {
  if (!w.account) return "Connect the owner wallet.";
  if (!e) return "Ethereum state is unavailable.";
  if (!same(w.account, e.owner)) return "Only the garden's onchain owner can prepare burn batches.";
  if (w.chainId !== 1) return "Switch your wallet to Ethereum.";
  if (!e.activated) return "The garden is not activated.";
  if (busy) return "A burn operation is already pending.";
  if (maximum === null || maximum <= 0n) return "Enter a maximum amount.";
  if (!planQueue(e.burnQueued, maximum).ok) return "Less than one bridge unit (0.000001 IMD) would be queued.";
  return null;
}
export function dispatchEligibility(w: WalletCtx, e: EthSnap | undefined, job: Job | undefined, busy: boolean): string | null {
  if (!w.account) return "Connect the owner wallet.";
  if (!e || !job) return "Ethereum state is unavailable.";
  if (!same(w.account, e.owner)) return "Only the garden's onchain owner can send batches.";
  if (w.chainId !== 1) return "Switch your wallet to Ethereum.";
  if (!e.activated || !e.baseReady) return "The bridge route is not ready.";
  if (job.status !== 1 && job.status !== 2) return "This job is not waiting to be sent.";
  if (busy) return "An operation for this job is already pending.";
  return null;
}
export function feeProblem(fee: { nativeFee: bigint; lzTokenFee: bigint }): string | null {
  if (fee.lzTokenFee !== 0n) return "The quote asks for a ZRO fee; the contract refuses it.";
  if (fee.nativeFee > MAX_NATIVE_FEE) return "The bridge fee is above the contract's 0.05 ETH ceiling.";
  return null;
}
export function retryEligibility(w: WalletCtx, b: BaseSnap | undefined, d: Delivery | null | undefined, busy: boolean): string | null {
  if (!d || d.status !== 2) return "Only a delivery whose burn failed can be retried.";
  if (!b?.activated) return "The Base receiver is not activated.";
  if (!w.account) return "Connect a wallet.";
  if (w.chainId !== 8453) return "Switch your wallet to Base.";
  if (busy) return "An operation for this delivery is already pending.";
  return null;
}
export function receiptEligibility(w: WalletCtx, b: BaseSnap | undefined, d: Delivery | null | undefined, busy: boolean): string | null {
  if (!d || d.status !== 3) return "Only a burned delivery can be confirmed.";
  if (d.acknowledged) return "The confirmation was already sent.";
  if (!b?.activated) return "The Base receiver is not activated.";
  if (!w.account) return "Connect a wallet.";
  if (w.chainId !== 8453) return "Switch your wallet to Base.";
  if (busy) return "An operation for this delivery is already pending.";
  return null;
}

// ---------- outcomes, from the mined receipt's own events (a successful receipt alone is not success) ----------
export type OpKind = "queue" | "dispatch" | "retry" | "receipt";
export interface MinedReceipt { status: "success" | "reverted"; transactionHash: Hash; logs: Pick<Log, "address" | "data" | "topics">[] }
export type Outcome =
  | { ok: true; kind: OpKind; text: string; jobId?: bigint; amount?: bigint; guid?: Hash; messageGuid?: Hash }
  | { ok: false; kind: OpKind; text: string; failedInside?: boolean };

function events(r: MinedReceipt, address: string, abi: readonly unknown[]) {
  const out: { eventName: string; args: Record<string, any> }[] = [];
  for (const l of r.logs) {
    if (l.address.toLowerCase() !== address.toLowerCase()) continue;
    try { out.push(decodeEventLog({ abi: abi as any, data: l.data, topics: l.topics as any }) as any); } catch { /* other event */ }
  }
  return out;
}

export function outcomeOf(kind: OpKind, target: string, r: MinedReceipt, garden: string, receiver: string): Outcome {
  if (r.status !== "success") return { ok: false, kind, text: "The transaction reverted. Nothing changed onchain; you paid only its gas." };
  if (kind === "queue") {
    const ev = events(r, garden, wishGardenAbi).find((x) => x.eventName === "BurnQueued");
    return ev ? { ok: true, kind, jobId: ev.args.jobId, amount: ev.args.amount, text: `Burn job #${ev.args.jobId} prepared with ${ev.args.amount} token units.` }
      : { ok: false, kind, text: "This transaction did not create a burn job (it may have been replaced by another transaction)." };
  }
  if (kind === "dispatch") {
    const id = BigInt(target), ev = events(r, garden, wishGardenAbi);
    const sent = ev.find((x) => x.eventName === "BurnDispatched" && x.args.jobId === id);
    if (sent) return { ok: true, kind, jobId: id, guid: sent.args.guid, text: `Job #${id} was sent to Base (attempt ${sent.args.attempt}).` };
    if (ev.some((x) => x.eventName === "BurnSendFailed" && x.args.jobId === id))
      return { ok: false, kind, failedInside: true, text: `The transaction succeeded but the bridge send for job #${id} failed inside the contract. The job stays reserved as Failed and the bridge fee was refunded. It can be retried.` };
    return { ok: false, kind, text: "This transaction did not send the job (it may have been replaced by another transaction)." };
  }
  const guid = target.toLowerCase(), ev = events(r, receiver, burnReceiverAbi);
  const hit = (n: string) => ev.find((x) => x.eventName === n && String(x.args.guid ?? x.args.burnGuid).toLowerCase() === guid);
  if (kind === "retry") {
    if (hit("SupplyBurned")) return { ok: true, kind, guid: target as Hash, text: "The retried burn succeeded: Base supply was reduced." };
    if (hit("BurnFailed")) return { ok: false, kind, failedInside: true, text: "The retry ran, but the burn failed again. The tokens stay held for burning and can be retried." };
    return { ok: false, kind, text: "This transaction did not retry this burn (it may have been replaced)." };
  }
  const rs = hit("ReceiptSent");
  return rs ? { ok: true, kind, guid: target as Hash, messageGuid: rs.args.messageGuid, text: "Confirmation sent. It is pending delivery to Ethereum." }
    : { ok: false, kind, text: "This transaction did not send the confirmation (it may have been replaced)." };
}

// ---------- pending operations, persisted across reloads and shared between tabs ----------
export interface BurnOp {
  id: string; kind: OpKind; chainId: 1 | 8453; account: string; target: string; value?: string;
  /** signing: the wallet was asked and has not returned a hash (a reload here leaves the outcome uncertain). */
  stage: "signing" | "sent"; hash?: Hash; createdAt: number;
  /** The exact request sent to the wallet (contract, calldata, value): a pasted or found transaction must carry it. */
  req?: { to: string; data: `0x${string}`; value: string };
  /** The sender's pending nonce and the head block read just before the wallet was asked (preflight). */
  nonce?: number; block?: string;
  /** Sender and nonce read from the sent transaction itself; once set, a mined same-nonce replacement settles it. */
  from?: string; nonceChecked?: boolean;
  /** queue: the reviewed amount in token units, compared with the mined BurnQueued amount. */
  expect?: string;
}
export const OPS_KEY = "everlight:v1:burnops:0x33a514c5e2028f1affd70b82f170e8193df030a5";
const storage = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export function listOps(s: Storage | null = storage()): BurnOp[] {
  try { const v = JSON.parse(s?.getItem(OPS_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
const write = (ops: BurnOp[], s: Storage | null) => { if (!s) throw new Error("storage"); s.setItem(OPS_KEY, JSON.stringify(ops)); };
/** Same operation: queue jobs conflict with each other; others conflict per job ID / GUID. */
export function conflicts(a: Pick<BurnOp, "kind" | "target">, b: Pick<BurnOp, "kind" | "target">): boolean {
  const eth = (k: OpKind) => k === "queue" || k === "dispatch";
  // an owner queue and any owner send change the same Ethereum balances: one at a time
  if (a.kind === "queue" || b.kind === "queue") return eth(a.kind) && eth(b.kind);
  return a.kind === b.kind && a.target.toLowerCase() === b.target.toLowerCase();
}

async function locked<T>(f: () => T): Promise<T> {
  const l = (typeof navigator !== "undefined" ? (navigator as any).locks : undefined);
  return l?.request ? l.request("everlight-burnops", async () => f()) : f();
}
/** Save a new operation unless a conflicting one is saved (in this or another tab). Returns false on conflict. */
export async function addOp(op: BurnOp, s: Storage | null = storage()): Promise<boolean> {
  return locked(() => {
    const ops = listOps(s);
    if (ops.some((o) => conflicts(op, o))) return false;
    write([...ops, op], s);
    return true;
  });
}
export async function updateOp(id: string, patch: Partial<BurnOp>, s: Storage | null = storage()): Promise<void> {
  await locked(() => write(listOps(s).map((o) => (o.id === id ? { ...o, ...patch } : o)), s));
}
export async function removeOp(id: string, s: Storage | null = storage()): Promise<void> {
  await locked(() => write(listOps(s).filter((o) => o.id !== id), s));
}

/**
 * Persist a hash the wallet returned. If the record was forgotten meanwhile (another tab, "forget it"), the operation
 * is saved again as sent: a returned hash is never dropped. Other saved operations are left untouched.
 */
export async function settleHash(op: BurnOp, hash: Hash, s: Storage | null = storage()): Promise<BurnOp> {
  const next: BurnOp = { ...op, stage: "sent", hash };
  await locked(() => {
    const ops = listOps(s);
    write(ops.some((o) => o.id === op.id) ? ops.map((o) => (o.id === op.id ? { ...o, stage: "sent", hash } : o)) : [...ops, next], s);
  });
  return next;
}

/** Name of the Web Lock a tab holds while its wallet request for an operation is outstanding. */
export const opLockName = (id: string) => `everlight-burnop-${id}`;
/**
 * Hold the operation's lock until `until` settles, so another tab can see the wallet request is still open.
 * Resolves once the lock is held (or immediately without Web Locks).
 */
export function holdOp(id: string, until: Promise<unknown>): Promise<void> {
  const l = typeof navigator !== "undefined" ? (navigator as any).locks : undefined;
  if (!l?.request) return Promise.resolve();
  return new Promise<void>((held) => {
    l.request(opLockName(id), async () => { held(); await until.catch(() => undefined); }).catch(() => held());
  });
}
/** True when some tab (this one included) still holds the wallet-request lock for this operation. */
export async function opHeld(id: string): Promise<boolean> {
  const l = typeof navigator !== "undefined" ? (navigator as any).locks : undefined;
  if (!l?.query) return false;
  try { const q = await l.query(); return (q.held ?? []).some((x: { name: string }) => x.name === opLockName(id)); } catch { return false; }
}

/**
 * A Base delivery is authenticated for a public action only when the Ethereum job it names (burnJobs), Base's
 * jobGuids(jobId) and deliveries(guid) agree on job ID, amount and GUID. Returns the reason it is not, or null.
 */
export function authenticateDelivery(guid: string, job: Job | undefined, jobGuidOnBase: Hash | undefined, d: Delivery | null | undefined): string | null {
  if (!job || jobGuidOnBase === undefined || d === undefined) return "The delivery could not be authenticated: a chain could not be read.";
  if (!d || d.status === 0) return "No Base delivery is recorded under this GUID.";
  const g = guid.toLowerCase();
  if (job.guid.toLowerCase() !== g || jobGuidOnBase.toLowerCase() !== g || d.jobId !== BigInt(job.id) || d.amount !== job.amount)
    return "Base delivery does not match this job's ID, amount or GUID, so public actions stay off.";
  return null;
}

/** Footer amount: never rounds a positive balance to "0". */
export function compactImd(v: bigint, fmt: (v: bigint, digits?: number) => string): string {
  if (v === 0n) return "0";
  const s = fmt(v);
  if (s !== "0") return s;
  const fine = fmt(v, 6);
  return fine !== "0" ? fine : "< 0.000001";
}
