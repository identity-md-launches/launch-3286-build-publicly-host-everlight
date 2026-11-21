// MOCKED tests: every chain read and receipt below is a fixture. No network, no wallet, no real funds.
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hash } from "viem";
import { wishGardenAbi } from "../src/abi/WishGarden";
import { burnReceiverAbi } from "../src/abi/EverlightBurnReceiver";
import {
  CONVERSION_RATE, OPS_KEY, ZERO32, addOp, conflicts, crossCheck, dispatchEligibility, feeProblem, isStale, jobPage, listOps, outcomeOf,
  parseImd, planQueue, queueEligibility, readConsistent, receiptEligibility, reconcile, removeOp, retryEligibility, updateOp,
  type BaseSnap, type BurnOp, type EthSnap,
} from "../src/lib/burn";
import { isRejection } from "../src/panels/BurnPanel";

const E = 10n ** 18n;
const OWNER = "0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9";
const OTHER = "0x1111111111111111111111111111111111111111";
const GARDEN = "0x33a514c5e2028f1affd70b82f170e8193df030a5";
const RECEIVER = "0x4FdE47d5b574F9F18bC86D9878A460e6b1373D1E";
const now = Date.now();
const eth = (p: Partial<EthSnap> = {}): EthSnap => ({
  block: 100n, ts: Math.floor(now / 1000), readAt: now, totalBurnAllocated: 54n * E / 10n, burnQueued: 54n * E / 10n, burnReserved: 0n, burnInTransit: 0n,
  confirmedBurn: 0n, failedBurnAmount: 0n, burnJobCount: 0n, bridgeDust: 0n, owner: OWNER, activated: true, baseReady: true, ...p,
});
const base = (p: Partial<BaseSnap> = {}): BaseSnap => ({
  block: 200n, ts: Math.floor(now / 1000), readAt: now, totalReceived: 0n, pendingBurn: 0n, failedBurn: 0n, totalBurned: 0n, activated: true, owner: OWNER, ...p,
});

describe("burn accounting", () => {
  it("burned is Base totalBurned and pending is allocation minus burned (live-like state: 5.4 IMD queued, nothing burned)", () => {
    const r = reconcile(eth(), base());
    expect(r.health).toBe("ok");
    expect(r.burned).toBe(0n);
    expect(r.pending).toBe(54n * E / 10n);
  });
  it("never adds confirmedBurn to totalBurned and never sums burnInTransit with Base pendingBurn", () => {
    // 10 allocated: 2 confirmed (burned+acked), 3 in transit of which 1 is burned-unacked and 2 pending on Base, 5 queued
    const r = reconcile(
      eth({ totalBurnAllocated: 10n * E, burnQueued: 5n * E, burnInTransit: 3n * E, confirmedBurn: 2n * E }),
      base({ totalReceived: 5n * E, pendingBurn: 2n * E, totalBurned: 3n * E }),
    );
    expect(r.health).toBe("ok");
    expect(r.burned).toBe(3n * E); // not 3 + 2 confirmed
    expect(r.pending).toBe(7n * E); // 10 - 3, not queued + inTransit + Base pending (= 10)
    expect(r.unacknowledgedBurned).toBe(1n * E);
    expect(r.inTransitUnburned).toBe(2n * E);
  });
  it("failed amounts are subsets: a failed send does not change pending", () => {
    const ok = reconcile(eth({ burnQueued: 4n * E, burnReserved: 14n * E / 10n, failedBurnAmount: 14n * E / 10n }), base());
    expect(ok.health).toBe("ok");
    expect(ok.pending).toBe(54n * E / 10n);
    const bad = reconcile(eth({ burnQueued: 4n * E, burnReserved: 14n * E / 10n, failedBurnAmount: 2n * E }), base());
    expect(bad.health).toBe("inconsistent");
    expect(bad.pending).toBeUndefined();
  });
  it("a cross-chain mismatch is Unavailable, never a clamped negative or zero", () => {
    const r = reconcile(eth({ totalBurnAllocated: 1n * E, burnQueued: 1n * E }), base({ totalReceived: 2n * E, totalBurned: 2n * E }));
    expect(r.health).toBe("inconsistent");
    expect(r.pending).toBeUndefined();
    expect(r.issues.join(" ")).toMatch(/Base burned more/);
  });
  it("an internally inconsistent Base read leaves burned Unavailable", () => {
    const r = reconcile(eth(), base({ totalReceived: 1n, totalBurned: 0n }));
    expect(r.burned).toBeUndefined();
    expect(r.pending).toBeUndefined();
  });
  it("RPC failure on one chain: partial, pending Unavailable", () => {
    const r = reconcile(eth(), null);
    expect(r.health).toBe("partial");
    expect(r.pending).toBeUndefined();
    expect(reconcile(null, null).health).toBe("unavailable");
  });
  it("retries inconsistent cross-chain reads and succeeds once both chains agree", async () => {
    let n = 0;
    // first read: Ethereum RPC lags behind a delivery Base already recorded
    const readEth = async () => (++n === 1 ? eth() : eth({ burnQueued: 4n * E, burnInTransit: 14n * E / 10n }));
    const readBase = async () => base({ totalReceived: 14n * E / 10n, totalBurned: 14n * E / 10n });
    const r = await readConsistent(readEth, readBase, 3, async () => {});
    expect(r.health).toBe("ok");
    expect(r.attempts).toBe(2);
    expect(r.pending).toBe(4n * E);
  });
  it("gives up after the retry budget and reports the inconsistency", async () => {
    const r = await readConsistent(async () => eth({ confirmedBurn: 1n, burnQueued: 54n * E / 10n - 1n }), async () => base(), 3, async () => {});
    expect(r.health).toBe("inconsistent");
    expect(r.attempts).toBe(3);
    expect(r.pending).toBeUndefined();
  });
  it("RPC errors become an unavailable result, not a thrown zero", async () => {
    const r = await readConsistent(async () => { throw new Error("rpc down"); }, async () => { throw new Error("rpc down"); }, 2, async () => {});
    expect(r.health).toBe("unavailable");
    expect(r.burned).toBeUndefined();
  });
  it("staleness: by block time and by read time", () => {
    expect(isStale(Math.floor(now / 1000), now, now)).toBe(false);
    expect(isStale(Math.floor(now / 1000) - 600, now, now)).toBe(true);
    expect(isStale(Math.floor(now / 1000), now - 600_000, now)).toBe(true);
    expect(isStale(undefined, undefined)).toBe(true);
  });
});

describe("bridge precision and amounts", () => {
  it("queueBurn rounds down to 1e12 units and reports dust", () => {
    const q = 5_400_000_000_000_123_456n;
    const p = planQueue(q, q);
    expect(p.amount).toBe(5_400_000_000_000_000_000n);
    expect(p.dust).toBe(123_456n);
    expect(p.remaining).toBe(123_456n);
    expect(p.amount % CONVERSION_RATE).toBe(0n);
  });
  it("caps at burnQueued and refuses less than one bridge unit", () => {
    expect(planQueue(2n * E, 5n * E).amount).toBe(2n * E);
    expect(planQueue(2n * E, 999_999_999_999n).ok).toBe(false);
  });
  it("parses decimal IMD without floating point", () => {
    expect(parseImd("5.4")).toBe(5_400_000_000_000_000_000n);
    expect(parseImd("0.000000000000000001")).toBe(1n);
    expect(parseImd("1e3")).toBeNull();
    expect(parseImd("-1")).toBeNull();
  });
  it("fee limits match the contracts", () => {
    expect(feeProblem({ nativeFee: 10n ** 15n, lzTokenFee: 0n })).toBeNull();
    expect(feeProblem({ nativeFee: 6n * 10n ** 16n, lzTokenFee: 0n })).toMatch(/ceiling/);
    expect(feeProblem({ nativeFee: 1n, lzTokenFee: 1n })).toMatch(/ZRO/);
  });
});

describe("authorization and chain", () => {
  const job = { id: 1, amount: 5n * E, guid: ZERO32, attempts: 0, status: 1 };
  it("only the onchain owner (read from owner()) on Ethereum can queue or dispatch", () => {
    expect(queueEligibility({ account: OWNER, chainId: 1 }, eth(), 5n * E, false)).toBeNull();
    expect(queueEligibility({ account: OTHER, chainId: 1 }, eth(), 5n * E, false)).toMatch(/owner/);
    expect(queueEligibility({ account: OWNER, chainId: 8453 }, eth(), 5n * E, false)).toMatch(/Ethereum/);
    expect(queueEligibility({ account: OWNER, chainId: 1 }, eth({ owner: OTHER }), 5n * E, false)).toMatch(/owner/);
    expect(queueEligibility({}, eth(), 5n * E, false)).toMatch(/Connect/);
    expect(queueEligibility({ account: OWNER, chainId: 1 }, eth(), 5n * E, true)).toMatch(/pending/);
    expect(dispatchEligibility({ account: OWNER, chainId: 1 }, eth(), job, false)).toBeNull();
    expect(dispatchEligibility({ account: OTHER, chainId: 1 }, eth(), job, false)).toMatch(/owner/);
    expect(dispatchEligibility({ account: OWNER, chainId: 1 }, eth(), { ...job, status: 3 }, false)).toMatch(/not waiting/);
    expect(dispatchEligibility({ account: OWNER, chainId: 1 }, eth(), { ...job, status: 2 }, false)).toBeNull(); // failed send: retry
    expect(dispatchEligibility({ account: OWNER, chainId: 1 }, eth({ baseReady: false }), job, false)).toMatch(/not ready/);
  });
  it("public Base actions: retry only Failed, confirmation only Burned and not acknowledged, on Base", () => {
    const d = (status: number, acknowledged = false) => ({ jobId: 1n, amount: E, attempts: 1, status, acknowledged });
    const w = { account: OTHER, chainId: 8453 };
    expect(retryEligibility(w, base(), d(2), false)).toBeNull();
    expect(retryEligibility(w, base(), d(3), false)).toMatch(/failed/);
    expect(retryEligibility(w, base(), d(1), false)).toMatch(/failed/);
    expect(retryEligibility({ account: OTHER, chainId: 1 }, base(), d(2), false)).toMatch(/Base/);
    expect(receiptEligibility(w, base(), d(3), false)).toBeNull();
    expect(receiptEligibility(w, base(), d(3, true), false)).toMatch(/already sent/);
    expect(receiptEligibility(w, base(), d(2), false)).toMatch(/burned/);
    expect(receiptEligibility(w, base(), null, false)).toMatch(/burned/);
    expect(receiptEligibility(w, base(), d(3), true)).toMatch(/pending/);
  });
  it("wallet rejection is recognised through viem's cause chain", () => {
    expect(isRejection({ shortMessage: "x", cause: { code: 4001 } })).toBe(true);
    expect(isRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isRejection({ cause: { code: -32603 } })).toBe(false);
  });
});

describe("jobs and cross-checks", () => {
  const guid = `0x${"ab".repeat(32)}` as Hash;
  const job = { id: 3, amount: 2n * E, guid, attempts: 1, status: 3 };
  it("pages newest first; burnJobCount is historical", () => {
    expect(jobPage(23, 0, 10)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14]);
    expect(jobPage(23, 2, 10)).toEqual([3, 2, 1]);
    expect(jobPage(0, 0, 10)).toEqual([]);
  });
  it("matches a Base delivery against the Ethereum job GUID", () => {
    expect(crossCheck(job, guid, { jobId: 3n, amount: 2n * E, attempts: 1, status: 3, acknowledged: false }).ok).toBe(true);
    expect(crossCheck(job, guid, { jobId: 4n, amount: 2n * E, attempts: 1, status: 3, acknowledged: false }).ok).toBe(false);
    expect(crossCheck(job, ZERO32, { jobId: 0n, amount: 0n, attempts: 0, status: 0, acknowledged: false }).note).toMatch(/In flight/);
    expect(crossCheck(job, undefined, undefined).ok).toBe(false);
    expect(crossCheck({ ...job, guid: ZERO32, status: 2 }, ZERO32, null).ok).toBe(true);
    expect(crossCheck({ ...job, status: 4 }, guid, { jobId: 3n, amount: 2n * E, attempts: 1, status: 3, acknowledged: false }).ok).toBe(false);
  });
});

describe("outcomes are judged by events, not by receipt status", () => {
  const log = (abi: any, eventName: string, args: any, address: string) => {
    const ev = abi.find((x: any) => x.type === "event" && x.name === eventName);
    const indexed = ev.inputs.filter((i: any) => i.indexed), plain = ev.inputs.filter((i: any) => !i.indexed);
    return {
      address,
      topics: encodeEventTopics({ abi, eventName, args: Object.fromEntries(indexed.map((i: any) => [i.name, args[i.name]])) } as any) as any,
      data: encodeAbiParameters(plain, plain.map((i: any) => args[i.name])),
    };
  };
  const rec = (logs: any[], status: "success" | "reverted" = "success") => ({ status, transactionHash: `0x${"11".repeat(32)}` as Hash, logs });
  const guid = `0x${"cd".repeat(32)}` as Hash;
  it("dispatch: BurnDispatched is success", () => {
    const o = outcomeOf("dispatch", "1", rec([log(wishGardenAbi, "BurnDispatched", { jobId: 1n, guid, amount: E, attempt: 1 }, GARDEN)]), GARDEN, RECEIVER);
    expect(o.ok).toBe(true);
  });
  it("dispatch: a successful receipt with BurnSendFailed is NOT success (failed-send recovery path)", () => {
    const o = outcomeOf("dispatch", "1", rec([log(wishGardenAbi, "BurnSendFailed", { jobId: 1n, attempt: 1, reasonHash: guid }, GARDEN)]), GARDEN, RECEIVER);
    expect(o.ok).toBe(false);
    expect(o.ok === false && o.failedInside).toBe(true);
    expect(o.text).toMatch(/retried/);
  });
  it("dispatch: an event from another contract or another job does not count", () => {
    expect(outcomeOf("dispatch", "1", rec([log(wishGardenAbi, "BurnDispatched", { jobId: 1n, guid, amount: E, attempt: 1 }, OTHER)]), GARDEN, RECEIVER).ok).toBe(false);
    expect(outcomeOf("dispatch", "1", rec([log(wishGardenAbi, "BurnDispatched", { jobId: 2n, guid, amount: E, attempt: 1 }, GARDEN)]), GARDEN, RECEIVER).ok).toBe(false);
  });
  it("reverted and replaced transactions are not success", () => {
    expect(outcomeOf("queue", "all", rec([], "reverted"), GARDEN, RECEIVER).text).toMatch(/reverted/);
    expect(outcomeOf("queue", "all", rec([]), GARDEN, RECEIVER).text).toMatch(/replaced/);
    expect(outcomeOf("queue", "all", rec([log(wishGardenAbi, "BurnQueued", { jobId: 7n, amount: E }, GARDEN)]), GARDEN, RECEIVER).ok).toBe(true);
  });
  it("Base retry distinguishes a burn that failed again from a real burn", () => {
    expect(outcomeOf("retry", guid, rec([log(burnReceiverAbi, "SupplyBurned", { guid, jobId: 1n, amount: E, cumulativeBurned: E }, RECEIVER)]), GARDEN, RECEIVER).ok).toBe(true);
    const again = outcomeOf("retry", guid, rec([log(burnReceiverAbi, "BurnFailed", { guid, attempt: 2, reasonHash: guid }, RECEIVER)]), GARDEN, RECEIVER);
    expect(again.ok).toBe(false);
    expect(again.text).toMatch(/failed again/);
  });
  it("confirmation sent is reported as pending delivery to Ethereum, not as confirmed", () => {
    const o = outcomeOf("receipt", guid, rec([log(burnReceiverAbi, "ReceiptSent", { burnGuid: guid, messageGuid: guid, kind: 2 }, RECEIVER)]), GARDEN, RECEIVER);
    expect(o.ok).toBe(true);
    expect(o.text).toMatch(/pending delivery/);
  });
});

describe("saved operations (reload recovery, duplicate tabs)", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage; };
  const op = (p: Partial<BurnOp> = {}): BurnOp => ({ id: "a", kind: "dispatch", chainId: 1, account: OWNER, target: "1", stage: "signing", createdAt: 1, ...p });
  it("persists, updates with the hash, and survives a reload (fresh read of the same storage)", async () => {
    const s = mem();
    expect(await addOp(op(), s)).toBe(true);
    await updateOp("a", { stage: "sent", hash: `0x${"22".repeat(32)}` as Hash }, s);
    const after = listOps(s);
    expect(after).toHaveLength(1);
    expect(after[0].hash).toMatch(/^0x22/);
    expect(JSON.parse(s.getItem(OPS_KEY)!)[0].stage).toBe("sent");
    await removeOp("a", s);
    expect(listOps(s)).toHaveLength(0);
  });
  it("a second tab cannot start the same operation", async () => {
    const s = mem();
    expect(await addOp(op(), s)).toBe(true);
    expect(await addOp(op({ id: "b" }), s)).toBe(false); // same job
    expect(await addOp(op({ id: "c", kind: "queue", target: "all" }), s)).toBe(false); // owner ops are serialised
    expect(await addOp(op({ id: "d", kind: "retry", chainId: 8453, target: "0xab" }), s)).toBe(true);
    expect(await addOp(op({ id: "e", kind: "retry", chainId: 8453, target: "0xAB" }), s)).toBe(false);
  });
  it("conflict rules", () => {
    expect(conflicts({ kind: "queue", target: "1" }, { kind: "dispatch", target: "4" })).toBe(true);
    expect(conflicts({ kind: "dispatch", target: "1" }, { kind: "dispatch", target: "2" })).toBe(false);
    expect(conflicts({ kind: "receipt", target: "0x1" }, { kind: "retry", target: "0x1" })).toBe(false);
  });
});
