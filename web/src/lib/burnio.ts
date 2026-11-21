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
 * Adaptive log scan: halves the range when an RPC refuses it, and stops after `budget` requests. Returns what it found
 * and whether it covered the whole range (RPC range limits and partial history are labelled, never hidden).
 */
export async function scanLogs(c: PublicClient, address: Hash, events: readonly any[], from: bigint, to: bigint, step: bigint, budget: number) {
  const logs: any[] = [];
  let at = from, size = step, used = 0;
  while (at <= to && used < budget) {
    const end = at + size - 1n > to ? to : at + size - 1n;
    used++;
    try {
      logs.push(...(await c.getLogs({ address, events: events as any, fromBlock: at, toBlock: end })));
      at = end + 1n;
    } catch {
      if (size <= 500n) break;
      size /= 2n;
    }
  }
  return { logs, complete: at > to, scannedTo: at - 1n };
}

/** Transaction hashes for every job, from events matched to the job ID / GUID. Used for explorer links only. */
export async function readHistory(eth: PublicClient, base: PublicClient, ethHead: bigint, baseHead: bigint): Promise<JobHistory> {
  const h: JobHistory = { eth: new Map(), base: new Map(), complete: true };
  const add = <K,>(m: Map<K, TxRef[]>, k: K, t: TxRef) => m.set(k, [...(m.get(k) ?? []).filter((x) => x.hash !== t.hash || x.name !== t.name), t]);
  const e = await scanLogs(eth, GARDEN, ETH_EVENTS, GARDEN_DEPLOY_BLOCK, ethHead, 50_000n, 40);
  for (const l of e.logs) add(h.eth, Number(l.args.jobId), { hash: l.transactionHash, block: l.blockNumber, name: l.eventName, detail: l.args.guid });
  // Base: newest first is what users need; scan from the receiver's creation within a bounded request budget
  const b = await scanLogs(base, BASE_RECEIVER as Hash, BASE_EVENTS, BASE_RECEIVER_DEPLOY_BLOCK, baseHead, 10_000n, 60);
  for (const l of b.logs) add(h.base, String(l.args.guid ?? l.args.burnGuid).toLowerCase(), { hash: l.transactionHash, block: l.blockNumber, name: l.eventName, detail: l.args.messageGuid });
  if (!e.complete || !b.complete) {
    h.complete = false;
    h.note = `Event history is partial (Ethereum scanned to block ${e.scannedTo}, Base to block ${b.scannedTo}); job states above are read directly and are complete.`;
  }
  return h;
}
