// MOCKED tests for revision 18: fixtures only. No network, no wallet, no real funds.
import { describe, expect, it } from "vitest";
import { encodeFunctionData, type Hash, type Hex } from "viem";
import { wishGardenAbi } from "../src/abi/WishGarden";
import { planQueue, type BurnOp, type MinedReceipt } from "../src/lib/burn";
import { locateOp, mismatch, requestOf, verifyPasted, type OpClient, type SeenOpTx } from "../src/lib/burnrecover";
import { extendHistory, type JobHistory } from "../src/lib/burnio";

const E = 10n ** 18n;
const ME = "0x00000000000000000000000000000000000000a1";
const GARDEN = "0x33a514c5e2028f1affd70b82f170e8193df030a5";
const RECEIVER = "0x4fde47d5b574f9f18bc86d9878a460e6b1373d1e";
const h = (c: string) => `0x${c.repeat(64)}` as Hash;
const data1 = encodeFunctionData({ abi: wishGardenAbi, functionName: "queueBurn", args: [E] });
const op = (p: Partial<BurnOp> = {}): BurnOp => ({
  id: "a", kind: "queue", chainId: 1, account: ME, target: "1", value: "0", stage: "signing", createdAt: 1,
  req: { to: GARDEN, data: data1, value: "0" }, nonce: 7, block: "100", expect: String(E), ...p,
});
const tx = (p: Partial<SeenOpTx> = {}): SeenOpTx => ({ hash: h("a"), from: ME, to: GARDEN, input: data1, nonce: 7, value: 0n, chainId: 1, ...p });
const rcpt = (hash: Hash): MinedReceipt => ({ status: "success", transactionHash: hash, logs: [] });

/** In-memory chain: mined transactions by hash, block -> transactions, nonce counts by block. */
function chain(o: { txs?: SeenOpTx[]; mined?: Record<string, bigint>; latest?: number; pending?: number; head?: bigint } = {}): OpClient & { lookups: string[] } {
  const txs = new Map((o.txs ?? []).map((t) => [t.hash, t]));
  const mined = o.mined ?? {};
  const lookups: string[] = [];
  return {
    lookups,
    receipt: async (x) => { lookups.push(`receipt ${x.slice(0, 6)}`); return mined[x] !== undefined ? rcpt(x) : null; },
    tx: async (x) => { lookups.push(`tx ${x.slice(0, 6)}`); return txs.get(x) ?? null; },
    nonceAt: async (_a, b) => {
      if (b === undefined) return o.latest ?? 7;
      // count of mined nonces at block b
      return 7 + Object.entries(mined).filter(([x, at]) => at <= b && (txs.get(x as Hash)?.nonce ?? 0) >= 7).length;
    },
    pendingNonce: async () => o.pending ?? o.latest ?? 7,
    head: async () => o.head ?? 110n,
    blockTxs: async (b) => Object.entries(mined).filter(([, at]) => at === b).map(([x]) => ({ hash: x as Hash, from: ME, nonce: txs.get(x as Hash)!.nonce })),
  };
}

describe("queueBurn is asked for the reviewed amount", () => {
  it("the bridge-rounded amount used as the maximum cannot be enlarged by a later purchase", () => {
    const reviewed = planQueue(54n * E / 10n, 6n * E).amount;
    expect(reviewed).toBe(54n * E / 10n);
    // a candle adds 0.3 IMD before the transaction is mined: the contract reserves min(argument, burnQueued)
    expect(planQueue(57n * E / 10n, reviewed).amount).toBe(reviewed);
    // the typed maximum would have reserved more than the review showed
    expect(planQueue(57n * E / 10n, 6n * E).amount).toBe(57n * E / 10n);
  });
});

describe("a pasted hash must carry the saved request", () => {
  const req = op().req!;
  it("accepts exactly the request", () => { expect(mismatch(op(), tx(), req)).toBeNull(); });
  it("refuses another chain, sender, contract, calldata, value or an older nonce", () => {
    expect(mismatch(op(), tx({ chainId: 8453 }), req)).toMatch(/not on Ethereum/);
    expect(mismatch(op(), tx({ from: GARDEN }), req)).toMatch(/different account/);
    expect(mismatch(op(), tx({ to: RECEIVER }), req)).toMatch(/different contract/);
    expect(mismatch(op(), tx({ input: encodeFunctionData({ abi: wishGardenAbi, functionName: "queueBurn", args: [2n * E] }) }), req)).toMatch(/different call/);
    expect(mismatch(op(), tx({ value: 1n }), req)).toMatch(/different ETH value/);
    expect(mismatch(op(), tx({ nonce: 6 }), req)).toMatch(/older/);
  });
  it("verifyPasted rejects malformed and unknown hashes and returns the verified nonce", async () => {
    const c = chain({ txs: [tx()] });
    expect(await verifyPasted(c, op(), req, "0x12")).toMatchObject({ ok: false, reason: expect.stringMatching(/64 hexadecimal/) });
    expect(await verifyPasted(c, op(), req, h("f"))).toMatchObject({ ok: false, reason: expect.stringMatching(/not found on Ethereum/) });
    expect(await verifyPasted(c, op(), req, h("a"))).toEqual({ ok: true, hash: h("a"), from: ME, nonce: 7 });
  });
  it("rebuilds the request of a record saved by an earlier version", () => {
    const r = requestOf(op({ req: undefined, kind: "dispatch", target: "3", value: "5" }), GARDEN, RECEIVER)!;
    expect(r.to).toBe(GARDEN);
    expect(r.value).toBe("5");
    expect(r.data).toBe(encodeFunctionData({ abi: wishGardenAbi, functionName: "dispatchBurn", args: [3n] }));
  });
});

describe("hashless attempts stay guarded until evidence settles them", () => {
  it("pending while the saved nonce is not mined", async () => {
    expect(await locateOp(chain({ latest: 7, pending: 8 }), op(), op().req!)).toEqual({ kind: "pending" });
  });
  it("found when a mined transaction at a later nonce carries the request", async () => {
    const c = chain({ txs: [tx({ hash: h("e"), to: ME, input: "0x" as Hex, nonce: 7 }), tx({ hash: h("a"), nonce: 8 })], mined: { [h("e")]: 101n, [h("a")]: 102n }, latest: 9 });
    expect(await locateOp(c, op(), op().req!)).toMatchObject({ kind: "mined", hash: h("a") });
  });
  it("not-found only when every nonce since the saved one was used by another call and nothing is pending", async () => {
    const c = chain({ txs: [tx({ hash: h("e"), to: ME, input: "0x" as Hex })], mined: { [h("e")]: 101n }, latest: 8, pending: 8 });
    expect(await locateOp(c, op(), op().req!)).toEqual({ kind: "not-found", checked: 1 });
    const busy = chain({ txs: [tx({ hash: h("e"), to: ME, input: "0x" as Hex })], mined: { [h("e")]: 101n }, latest: 8, pending: 9 });
    expect(await locateOp(busy, op(), op().req!)).toEqual({ kind: "pending" });
  });
  it("unknown (never released) without a saved nonce", async () => {
    expect(await locateOp(chain(), op({ nonce: undefined }), op().req!)).toMatchObject({ kind: "unknown" });
  });
});

describe("a sent hash settles through its same-nonce replacement", () => {
  it("reads and returns the sender and nonce while pending", async () => {
    const c = chain({ txs: [tx({ hash: h("b") })], latest: 7, pending: 8 });
    expect(await locateOp(c, op({ stage: "sent", hash: h("b") }), op().req!)).toEqual({ kind: "pending", seen: { from: ME, nonce: 7 } });
  });
  it("after reload, with the old hash dropped, finds the mined replacement by its saved nonce", async () => {
    const c = chain({ txs: [tx({ hash: h("d") })], mined: { [h("d")]: 104n }, latest: 8 });
    const r = await locateOp(c, op({ stage: "sent", hash: h("b"), from: ME, nonce: 7, nonceChecked: true }), op().req!);
    expect(r).toMatchObject({ kind: "mined", hash: h("d"), replaced: true });
    expect(c.lookups.some((l) => l.startsWith("receipt 0xdddd"))).toBe(true);
  });
  it("a cancel replacement (different call) also settles the record: the original can no longer be mined", async () => {
    const c = chain({ txs: [tx({ hash: h("d"), to: ME, input: "0x" as Hex })], mined: { [h("d")]: 104n }, latest: 8 });
    expect(await locateOp(c, op({ stage: "sent", hash: h("b"), from: ME, nonce: 7, nonceChecked: true }), op().req!)).toMatchObject({ kind: "mined", hash: h("d"), replaced: true });
  });
});

describe("history follows the snapshot", () => {
  const prev: JobHistory = { eth: new Map([[1, [{ hash: h("5"), block: 90n, name: "BurnQueued" }]]]), base: new Map(), complete: true, ethFrom: 1n, ethTo: 100n, baseFrom: 1n, baseTo: 500n };
  const client = (logs: any[], fail = false) => ({ calls: [] as string[], async getLogs(q: any) { this.calls.push(`${q.fromBlock}-${q.toBlock}`); if (fail) throw new Error("limit"); return logs.filter((l) => l.blockNumber >= q.fromBlock && l.blockNumber <= q.toBlock); } });
  it("scans only the new blocks and merges the new event into the job", async () => {
    const eth = client([{ blockNumber: 101n, transactionHash: h("6"), eventName: "BurnDispatched", args: { jobId: 1n, guid: h("a") } }]);
    const base = client([]);
    const n = await extendHistory(eth as any, base as any, prev, 102n, 500n);
    expect(eth.calls).toEqual(["101-102"]);
    expect(base.calls).toEqual([]);
    expect(n.ethTo).toBe(102n);
    expect(n.eth.get(1)!.map((t) => t.name)).toEqual(["BurnQueued", "BurnDispatched"]);
    expect(n.note).toBeUndefined();
    expect(prev.eth.get(1)!.length).toBe(1); // the cached history is not mutated
  });
  it("a failed scan keeps cached links, does not advance coverage, and says so", async () => {
    const n = await extendHistory(client([], true) as any, client([]) as any, prev, 105n, 500n);
    expect(n.ethTo).toBe(100n);
    expect(n.eth.get(1)!.length).toBe(1);
    expect(n.note).toMatch(/current through Ethereum block 100/);
  });
});
