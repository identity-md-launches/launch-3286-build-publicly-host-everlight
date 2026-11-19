import { describe, expect, it } from "vitest";
import { classify, scanActivity, type LogReader } from "../src/lib/activity";

const DEPLOY = 26_433_359n;
const HEAD = DEPLOY + 100_000n;
type L = { block: bigint };

function host(name: string, answer: (from: bigint, to: bigint) => L[] | Error) {
  const calls: [bigint, bigint][] = [];
  const r: LogReader<L> = {
    name,
    async getLogs(from, to) {
      calls.push([from, to]);
      const a = answer(from, to);
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { r, calls };
}
const err = (message: string, status?: number) => Object.assign(new Error(message), status ? { status } : {});

describe("recent activity scan", () => {
  it("reads whole 5,000-block windows when the host allows them", async () => {
    const a = host("a", () => []);
    const s = await scanActivity({ head: HEAD, deployBlock: DEPLOY, readers: [a.r] });
    expect(a.calls).toHaveLength(8);
    expect(a.calls[0]).toEqual([HEAD - 4_999n, HEAD]);
    expect(s).toMatchObject({ stopped: null, complete: false, scannedBlocks: 40_000n });
  });

  it("narrows to 50-block chunks on a range error instead of repeating 5,000-block requests (reviewer mock)", async () => {
    const hosts = [0, 1, 2, 3].map((i) => host(`h${i}`, (f, t) => (t - f + 1n > 1_000n ? err("query exceeds max block range") : [])));
    const s = await scanActivity({ head: HEAD, deployBlock: DEPLOY, readers: hosts.map((h) => h.r) });
    const all = hosts.flatMap((h) => h.calls);
    expect(all.filter(([f, t]) => t - f + 1n > 50n)).toHaveLength(4); // one whole-window probe per host
    expect(s.requests).toBe(48); // fixed budget
    expect(s.stopped?.reason).toBe("budget");
    expect(s.scannedFrom).toBe(HEAD - 44n * 50n + 1n); // 44 verified chunks, contiguous from the head
    expect(s.scannedBlocks).toBe(2_200n);
  });

  it("keeps the verified recent windows when an older window is archive-only (live PublicNode/dRPC/1RPC/Merkle pattern)", async () => {
    const cutoff = HEAD - 30_000n;
    const pn = host("publicnode", (f, t) => (f < cutoff ? err("Archive requests require a personal token", 403) : t === HEAD - 4_999n * 0n ? [{ block: HEAD - 2n }] : []));
    const drpc = host("drpc", (f, t) => (t - f + 1n > 100n ? err("ranges over 100 blocks are not supported on free plan", 400) : []));
    const one = host("1rpc", (f, t) => (t - f + 1n > 50n ? err("eth_getLogs is limited to 0 - 50 blocks range") : []));
    const merkle = host("merkle", () => err("Failed to fetch"));
    const s = await scanActivity({ head: HEAD, deployBlock: DEPLOY, readers: [pn.r, drpc.r, one.r, merkle.r] });
    expect(s.logs).toEqual([{ block: HEAD - 2n }]);
    expect(s.scannedFrom).toBeLessThan(HEAD - 25_000n); // the five whole windows above the cutoff are kept
    expect(s.stopped?.reason).toBe("budget");
    expect(drpc.calls.filter(([f, t]) => t - f + 1n <= 50n).length).toBeGreaterThan(20); // older blocks read in 50-block chunks
    expect(merkle.calls).toHaveLength(1); // a network failure is not retried within the scan
    expect(s.requests).toBeLessThanOrEqual(48);
  });

  it("throws only when no block at all was verified", async () => {
    const dead = host("dead", () => err("Failed to fetch"));
    await expect(scanActivity({ head: HEAD, deployBlock: DEPLOY, readers: [dead.r] })).rejects.toThrow(/could not be read/);
  });

  it("stops at the deployment block and reports completeness", async () => {
    const a = host("a", () => []);
    const s = await scanActivity({ head: DEPLOY + 7_000n, deployBlock: DEPLOY, readers: [a.r] });
    expect(a.calls).toEqual([[DEPLOY + 2_001n, DEPLOY + 7_000n], [DEPLOY, DEPLOY + 2_000n]]);
    expect(s).toMatchObject({ complete: true, scannedFrom: DEPLOY, stopped: null });
  });

  it("classifies the live provider answers", () => {
    expect(classify(err("Archive requests require a personal token", 403)).kind).toBe("archive");
    expect(classify(err("ranges over 100 blocks are not supported on free plan"))).toMatchObject({ kind: "range", limit: 100n });
    expect(classify(err("eth_getLogs is limited to 0 - 50 blocks range"))).toMatchObject({ kind: "range", limit: 50n });
    expect(classify(err("Failed to fetch")).kind).toBe("network");
  });
});
