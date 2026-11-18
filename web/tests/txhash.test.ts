// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findCandleTx, knownTx, rememberTx, type TxClient } from "../src/lib/txhash";
import { GARDEN_DEPLOY_BLOCK } from "../src/config";

/** Simulated chain: one block every 12 s with a few missed slots, and two purchases by the same wallet. */
function chain() {
  const t0 = 1_760_000_000;
  const head = GARDEN_DEPLOY_BLOCK + 50_000n;
  const ts = (b: bigint) => t0 + Number(b - GARDEN_DEPLOY_BLOCK) * 12 + Math.floor(Number(b - GARDEN_DEPLOY_BLOCK) / 1000) * 12;
  const owner = "0x2222222222222222222222222222222222222222";
  const buys = [
    { block: GARDEN_DEPLOY_BLOCK + 31_337n, first: 5n, q: 3n, hash: "0x" + "ab".repeat(32) },
    { block: GARDEN_DEPLOY_BLOCK + 31_338n, first: 8n, q: 1n, hash: "0x" + "cd".repeat(32) },
  ];
  let reads = 0;
  const client: TxClient = {
    async getBlock(a) { reads++; const n = a?.blockNumber ?? head; return { number: n, timestamp: BigInt(ts(n)) }; },
    async getLogs(a) {
      reads++;
      return buys.filter((b) => b.block >= a.fromBlock && b.block <= a.toBlock && a.args.purchaser === owner)
        .map((b) => ({ transactionHash: b.hash, args: { firstCandleId: b.first, quantity: b.q } }));
    },
  };
  const candle = (id: number, block: bigint) => ({ id, purchaser: owner, style: 0, createdAt: ts(block), position: id - 1, wish: "" });
  return { client, buys, candle, reads: () => reads };
}

describe("candle -> transaction mapping", () => {
  it("finds the purchase transaction of a candle inside a batch", async () => {
    const { client, buys, candle } = chain();
    expect(await findCandleTx(client, candle(6, buys[0].block))).toBe(buys[0].hash);
    expect(await findCandleTx(client, candle(8, buys[1].block))).toBe(buys[1].hash);
    expect(knownTx(7)).toBe(buys[0].hash); // the whole batch is remembered
  });
  it("returns null when no matching log exists", async () => {
    const { client, candle } = chain();
    expect(await findCandleTx(client, candle(40, GARDEN_DEPLOY_BLOCK + 9_000n))).toBeNull();
  });
  it("rememberTx ignores malformed input", () => {
    rememberTx(100, 2, "0x1234");
    expect(knownTx(100)).toBeNull();
  });
});
