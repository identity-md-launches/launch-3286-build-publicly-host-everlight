import { parseAbiItem, type Hash, type PublicClient } from "viem";
import { wishGardenAbi } from "../abi/WishGarden";
import { burnReceiverAbi } from "../abi/EverlightBurnReceiver";
import { BASE_RECEIVER, BASE_RECEIVER_DEPLOY_BLOCK, GARDEN, GARDEN_DEPLOY_BLOCK } from "../config";
import { ZERO32, type BaseSnap, type Delivery, type EthSnap, type Job } from "./burn";

/** Live reads. Each snapshot reads every field at ONE block and records that block's number and timestamp. */
const ETH_FIELDS = ["totalBurnAllocated", "burnQueued", "burnReserved", "burnInTransit", "confirmedBurn", "failedBurnAmount", "burnJobCount", "bridgeDust", "owner", "activated", "baseReady"] as const;
const BASE_FIELDS = ["totalReceived", "pendingBurn", "failedBurn", "totalBurned", "activated", "owner"] as const;

export async function readEthSnap(c: PublicClient): Promise<EthSnap> {
  const blk = await c.getBlock({ blockTag: "latest" });
  const r = await c.multicall({ allowFailure: false, blockNumber: blk.number!, contracts: ETH_FIELDS.map((functionName) => ({ address: GARDEN, abi: wishGardenAbi, functionName })) as any });
  const o: any = { block: blk.number!, ts: Number(blk.timestamp), readAt: Date.now() };
  ETH_FIELDS.forEach((f, i) => (o[f] = r[i]));
  return o;
}
export async function readBaseSnap(c: PublicClient): Promise<BaseSnap> {
  const blk = await c.getBlock({ blockTag: "latest" });
  const r = await c.multicall({ allowFailure: false, blockNumber: blk.number!, contracts: BASE_FIELDS.map((functionName) => ({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName })) as any });
  const o: any = { block: blk.number!, ts: Number(blk.timestamp), readAt: Date.now() };
  BASE_FIELDS.forEach((f, i) => (o[f] = r[i]));
  return o;
}

/** Jobs read directly from the burnJobs mapping (not from events), at the Ethereum snapshot block. */
export async function readJobs(c: PublicClient, ids: number[], block?: bigint): Promise<Job[]> {
  if (!ids.length) return [];
  const r = await c.multicall({ allowFailure: false, blockNumber: block, contracts: ids.map((id) => ({ address: GARDEN, abi: wishGardenAbi, functionName: "burnJobs", args: [BigInt(id)] })) as any });
  return r.map((v: any, i) => ({ id: ids[i], amount: v[0], guid: v[1], attempts: Number(v[2]), status: Number(v[3]) }));
}
/** Base side of each job: jobGuids(jobId) and deliveries(guid) for the Ethereum GUID. undefined = not readable. */
export async function readDeliveries(c: PublicClient, jobs: Job[]): Promise<Map<number, { jobGuid?: Hash; delivery?: Delivery | null }>> {
  const out = new Map<number, { jobGuid?: Hash; delivery?: Delivery | null }>();
  if (!jobs.length) return out;
  const calls: any[] = [];
  for (const j of jobs) {
    calls.push({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "jobGuids", args: [BigInt(j.id)] });
    calls.push({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "deliveries", args: [j.guid] });
  }
  const r = await c.multicall({ allowFailure: true, contracts: calls });
  jobs.forEach((j, i) => {
    const g = r[2 * i], d = r[2 * i + 1];
    const dv = d.status === "success" ? (d.result as any) : undefined;
    out.set(j.id, {
      jobGuid: g.status === "success" ? (g.result as Hash) : undefined,
      delivery: j.guid === ZERO32 ? null : dv ? { jobId: dv[0], amount: dv[1], attempts: Number(dv[2]), status: Number(dv[3]), acknowledged: dv[4] } : undefined,
    });
  });
  return out;
}

export interface TxRef { hash: Hash; block: bigint; name: string; detail?: string }
export interface JobHistory { eth: Map<number, TxRef[]>; base: Map<string, TxRef[]>; complete: boolean; note?: string }

const ETH_EVENTS = [
  parseAbiItem("event BurnQueued(uint256 indexed jobId, uint256 amount)"),
  parseAbiItem("event BurnDispatched(uint256 indexed jobId, bytes32 indexed guid, uint256 amount, uint32 attempt)"),
  parseAbiItem("event BurnSendFailed(uint256 indexed jobId, uint32 attempt, bytes32 reasonHash)"),
  parseAbiItem("event BurnConfirmed(uint256 indexed jobId, bytes32 indexed guid, uint256 amount)"),
];
const BASE_EVENTS = [
  parseAbiItem("event BurnReceived(bytes32 indexed guid, uint256 indexed jobId, uint256 amount)"),
  parseAbiItem("event BurnFailed(bytes32 indexed guid, uint32 attempt, bytes32 reasonHash)"),
  parseAbiItem("event SupplyBurned(bytes32 indexed guid, uint256 indexed jobId, uint256 amount, uint256 cumulativeBurned)"),
  parseAbiItem("event ReceiptSent(bytes32 indexed burnGuid, bytes32 indexed messageGuid, uint8 kind)"),
];

/**
 * Adaptive log scan, NEWEST blocks first: halves the range when an RPC refuses it, and stops after `budget` requests.
 * Returns what it found and the range it covered (RPC range limits and partial history are labelled, never hidden).
 * `args` filters on indexed event arguments (one event only).
 */
export async function scanLogs(c: PublicClient, address: Hash, events: readonly any[], from: bigint, to: bigint, step: bigint, budget: number, args?: Record<string, unknown>) {
  const logs: any[] = [];
  let at = to, size = step, used = 0;
  while (at >= from && used < budget) {
    const start = at - size + 1n < from ? from : at - size + 1n;
    used++;
    try {
      const got = args
        ? await c.getLogs({ address, event: events[0], args, fromBlock: start, toBlock: at } as any)
        : await c.getLogs({ address, events: events as any, fromBlock: start, toBlock: at });
      logs.push(...got);
      at = start - 1n;
      if (args && got.length) break; // a filtered lookup stops at its (newest) hit
    } catch {
      if (size <= 250n) break;
      size /= 2n;
    }
  }
  return { logs, complete: at < from, scannedFrom: at + 1n, scannedTo: to };
}

/** Transaction hashes for every job, from events matched to the job ID / GUID. Used for explorer links only. */
export async function readHistory(eth: PublicClient, base: PublicClient, ethHead: bigint, baseHead: bigint): Promise<JobHistory> {
  const h: JobHistory = { eth: new Map(), base: new Map(), complete: true };
  const add = <K,>(m: Map<K, TxRef[]>, k: K, t: TxRef) => m.set(k, [...(m.get(k) ?? []).filter((x) => x.hash !== t.hash || x.name !== t.name), t]);
  const e = await scanLogs(eth, GARDEN, ETH_EVENTS, GARDEN_DEPLOY_BLOCK, ethHead, 50_000n, 40);
  // oldest first within each job, so "last" is the latest attempt
  for (const l of [...e.logs].sort((x, y) => Number(x.blockNumber - y.blockNumber))) add(h.eth, Number(l.args.jobId), { hash: l.transactionHash, block: l.blockNumber, name: l.eventName, detail: l.args.guid });
  // Base: newest blocks first, so recent deliveries and receipts are found even when an RPC limits the range
  const b = await scanLogs(base, BASE_RECEIVER as Hash, BASE_EVENTS, BASE_RECEIVER_DEPLOY_BLOCK, baseHead, 10_000n, 60);
  for (const l of [...b.logs].sort((x, y) => Number(x.blockNumber - y.blockNumber))) add(h.base, String(l.args.guid ?? l.args.burnGuid).toLowerCase(), { hash: l.transactionHash, block: l.blockNumber, name: l.eventName, detail: l.args.messageGuid });
  if (!e.complete || !b.complete) {
    h.complete = false;
    h.note = `Event history is partial (Ethereum scanned blocks ${e.scannedFrom}–${e.scannedTo}, Base ${b.scannedFrom}–${b.scannedTo}, newest first); job states above are read directly and are complete.`;
  }
  return h;
}

/** The ReceiptSent event for one burn GUID (indexed), searched newest first with explicit coverage. */
export async function readReceiptSent(base: PublicClient, burnGuid: Hash, budget = 40): Promise<{ tx?: TxRef; from: bigint; to: bigint; complete: boolean }> {
  const head = await base.getBlockNumber();
  const ev = BASE_EVENTS[3];
  const r = await scanLogs(base, BASE_RECEIVER as Hash, [ev], BASE_RECEIVER_DEPLOY_BLOCK, head, 10_000n, budget, { burnGuid });
  const l = r.logs.find((x) => String(x.args.burnGuid).toLowerCase() === burnGuid.toLowerCase());
  return {
    tx: l ? { hash: l.transactionHash, block: l.blockNumber, name: "ReceiptSent", detail: l.args.messageGuid } : undefined,
    from: r.scannedFrom, to: r.scannedTo, complete: r.complete,
  };
}
