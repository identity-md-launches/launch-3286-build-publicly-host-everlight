// MOCKED tests for revision 17: fixtures only. No network, no wallet, no real funds.
import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { OPS_KEY, addOp, authenticateDelivery, compactImd, listOps, removeOp, settleHash, type BurnOp, type Delivery, type Job } from "../src/lib/burn";
import { readReceiptSent, scanLogs } from "../src/lib/burnio";
import { imd } from "../src/lib/format";

const E = 10n ** 18n;
const GA = `0x${"ab".repeat(32)}` as Hash, GC = `0x${"cd".repeat(32)}` as Hash;
const job = (p: Partial<Job> = {}): Job => ({ id: 1, amount: 54n * E / 10n, guid: GA, attempts: 1, status: 3, ...p });
const dv = (p: Partial<Delivery> = {}): Delivery => ({ jobId: 1n, amount: 54n * E / 10n, attempts: 1, status: 2, acknowledged: false, ...p });

describe("public actions need an authenticated delivery", () => {
  it("passes only when job, jobGuids and delivery agree", () => {
    expect(authenticateDelivery(GA, job(), GA, dv())).toBeNull();
  });
  it("refuses a Base jobGuids that differs from the Ethereum GUID (reviewer's 0xabab/0xcdcd case)", () => {
    expect(authenticateDelivery(GA, job(), GC, dv())).toMatch(/does not match/);
    expect(authenticateDelivery(GA, job(), GC, dv({ status: 3 }))).toMatch(/does not match/);
  });
  it("refuses a different amount, job ID or target GUID, and fails closed when a read is missing", () => {
    expect(authenticateDelivery(GA, job(), GA, dv({ amount: 1n }))).toMatch(/does not match/);
    expect(authenticateDelivery(GA, job(), GA, dv({ jobId: 2n }))).toMatch(/does not match/);
    expect(authenticateDelivery(GC, job(), GA, dv())).toMatch(/does not match/);
    expect(authenticateDelivery(GA, undefined, GA, dv())).toMatch(/could not be authenticated/);
    expect(authenticateDelivery(GA, job(), undefined, dv())).toMatch(/could not be authenticated/);
    expect(authenticateDelivery(GA, job(), GA, undefined)).toMatch(/could not be authenticated/);
    expect(authenticateDelivery(GA, job(), GA, dv({ status: 0 }))).toMatch(/No Base delivery/);
  });
});

describe("footer amounts never read 0 for a positive balance", () => {
  it("shows 0.000001 for one bridge unit and a bound below it", () => {
    expect(compactImd(0n, imd)).toBe("0");
    expect(compactImd(10n ** 12n, imd)).toBe("0.000001");
    expect(compactImd(5399999n * 10n ** 12n, imd)).toBe("5.3999");
    expect(compactImd(1n, imd)).toBe("< 0.000001");
    expect(compactImd(54n * E / 10n, imd)).toBe("5.4");
  });
});

describe("a late wallet hash is never dropped", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as unknown as Storage; };
  const op = (p: Partial<BurnOp> = {}): BurnOp => ({ id: "a", kind: "queue", chainId: 1, account: "0x1", target: "1", stage: "signing", createdAt: 1, ...p });
  const H = `0x${"22".repeat(32)}` as Hash;
  it("updates the saved record in place", async () => {
    const s = mem();
    await addOp(op(), s);
    await settleHash(op(), H, s);
    expect(listOps(s)).toEqual([{ ...op(), stage: "sent", hash: H }]);
  });
  it("re-saves a forgotten operation with its hash, keeping a newer operation from another tab", async () => {
    const s = mem();
    await addOp(op(), s);
    await removeOp("a", s); // another tab forgot it
    await addOp(op({ id: "b", createdAt: 2 }), s); // and started its own
    await settleHash(op(), H, s);
    const ops = JSON.parse(s.getItem(OPS_KEY)!);
    expect(ops.map((o: BurnOp) => o.id)).toEqual(["b", "a"]);
    expect(ops[1].hash).toBe(H);
    expect(ops[0].stage).toBe("signing");
  });
});

describe("log scans run newest first under RPC range limits", () => {
  // labelled mock client: refuses ranges over 1,000 blocks, like the reviewer's RPC
  const client = (hit?: bigint) => {
    const calls: [bigint, bigint][] = [];
    return {
      calls,
      getBlockNumber: async () => 60_269_000n,
      getLogs: async (q: any) => {
        calls.push([q.fromBlock, q.toBlock]);
        if (BigInt(q.toBlock) - BigInt(q.fromBlock) + 1n > 1000n) throw new Error("range too large");
        return hit !== undefined && hit >= q.fromBlock && hit <= q.toBlock
          ? [{ transactionHash: `0x${"77".repeat(32)}`, blockNumber: hit, eventName: "ReceiptSent", args: { burnGuid: GA, messageGuid: GC, kind: 2 } }] : [];
      },
    };
  };
  it("finds a ReceiptSent one block below the head and stops", async () => {
    const c = client(60_268_999n);
    const r = await readReceiptSent(c as any, GA);
    expect(r.tx?.hash).toBe(`0x${"77".repeat(32)}`);
    expect(r.tx?.detail).toBe(GC);
    expect(c.calls[0][1]).toBe(60_269_000n); // first request ends at the head
    expect(c.calls.length).toBe(5); // 4 refused ranges, then the hit
  });
  it("reports partial coverage from the head downward when the budget runs out", async () => {
    const c = client();
    const r = await scanLogs(c as any, GA, [], 59_865_494n, 60_269_000n, 10_000n, 20);
    expect(r.complete).toBe(false);
    expect(r.scannedTo).toBe(60_269_000n);
    expect(r.scannedFrom).toBe(60_269_000n - 16n * 625n + 1n);
  });
});
