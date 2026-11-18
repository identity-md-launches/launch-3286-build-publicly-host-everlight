// Labelled local mock: the real chain/recovery/purchase modules with only the Ethereum client's reads replaced.
// No wallet, fork or live chain; nothing is sent.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { ethClient } from "../src/config";
import { NONCE_UNVERIFIED, settleBuyReceipt, settleReceipt } from "../src/lib/chain";
import { awaitBuy, pendingStore, REPLACED_MESSAGE, runPurchase, type PurchaseDeps, type PendingTx, type Step } from "../src/lib/purchase";

const ME = "0x1111111111111111111111111111111111111111";
const A = `0x${"a".repeat(64)}` as Hash; // the purchase the wallet actually sent (at nonce 11)
const B = `0x${"b".repeat(64)}` as Hash; // the wallet's replacement of A, nonce 11, mined at block 103
const C = `0x${"c".repeat(64)}` as Hash; // an unrelated self-transfer at nonce 9, mined at block 101

/** Mock chain: A unknown to the node (no tx, no receipt); C and B mined; historical nonce counts by block. */
function mockChain(opts: { knowsA?: boolean } = {}) {
  const txs: Record<string, { hash: Hash; from: string; to: string; input: `0x${string}`; nonce: number; blockNumber: bigint }> = {
    [C]: { hash: C, from: ME, to: ME, input: "0x", nonce: 9, blockNumber: 101n },
    [B]: { hash: B, from: ME, to: ME, input: "0x", nonce: 11, blockNumber: 103n },
  };
  if (opts.knowsA) txs[A] = { hash: A, from: ME, to: ME, input: "0x", nonce: 11, blockNumber: 0n };
  const nonceAt = (b: bigint) => (b <= 100n ? 9 : b === 101n ? 10 : b === 102n ? 11 : 12);
  const calls: string[] = [];
  Object.assign(ethClient, {
    getTransaction: async ({ hash }: { hash: Hash }) => { calls.push(`tx:${hash.slice(0, 4)}`); const t = txs[hash]; if (!t) throw new Error("not found"); return t; },
    getTransactionReceipt: async ({ hash }: { hash: Hash }) => {
      calls.push(`rcpt:${hash.slice(0, 4)}`);
      if (hash === A) throw new Error("receipt not found");
      return { status: "success", transactionHash: hash, logs: [], blockNumber: txs[hash].blockNumber };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hash }) => { calls.push(`wait:${hash.slice(0, 4)}`); throw new Error("Timed out while waiting for transaction"); },
    getTransactionCount: async (a: { blockNumber?: bigint }) => (a.blockNumber === undefined ? 12 : nonceAt(a.blockNumber)),
    getBlockNumber: async () => 104n,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ transactions: Object.values(txs).filter((t) => t.blockNumber === blockNumber) }),
  });
  return calls;
}

const deps = (over: Partial<PurchaseDeps> = {}): PurchaseDeps => ({
  account: ME, chainId: () => 1, salesOpen: async () => true,
  balance: async () => 10n ** 20n, allowance: async () => 10n ** 20n, ethBalance: async () => 10n ** 18n,
  approve: async () => { throw new Error("no approval expected"); },
  wait: async () => { throw new Error("pending"); },
  simulate: async () => ({}), buy: async () => A,
  submission: async () => ({ nonce: 9, block: 100n }),
  sentTx: async () => null,
  explain: (e) => (e instanceof Error ? e.message : String(e)),
  storage: localStorage,
  ...over,
});

const orig = { ...ethClient };
beforeEach(() => localStorage.clear());
afterEach(() => Object.assign(ethClient, orig));

describe("replacement recovery uses only a verified nonce (finding 139cd715)", () => {
  it("does not attribute an unrelated nonce-9 self-transfer to a purchase whose nonce was never verified", { timeout: 15_000 }, async () => {
    const steps: Step[] = [];
    const first = await runPurchase(deps(), [0], ["original"], (s) => steps.push(s));
    expect(first.name).toBe("buy-unknown");
    const saved = pendingStore.list()[0];
    expect(saved).toMatchObject({ hash: A, nonce: 9, block: "100", nonceChecked: false, styles: [0], wishes: ["original"] });

    const calls = mockChain();
    const s = await awaitBuy({ wait: settleBuyReceipt, storage: localStorage, explain: (e) => (e as Error).message }, saved, () => {});
    expect(s).toEqual({ name: "buy-unknown", hash: A, message: NONCE_UNVERIFIED });
    expect(s.name === "error" && s.message === REPLACED_MESSAGE).toBe(false);
    // A, its exact draft and its submission block stay saved and retryable
    expect(pendingStore.list()).toEqual([expect.objectContaining({ hash: A, nonce: 9, block: "100", nonceChecked: false, styles: [0], wishes: ["original"] })]);
    // C was never looked up: no block scan, no receipt of another hash
    expect(calls.some((c) => c.includes(C.slice(0, 4)) && c !== `tx:${A.slice(0, 4)}`)).toBe(false);
  });

  it("claims follow the same rule: an unverified claim nonce never settles on another transaction", async () => {
    mockChain();
    const claim: PendingTx = { hash: A, kind: "claim", account: ME, createdAt: Date.now(), from: ME, nonce: 9, block: "100", nonceChecked: false };
    pendingStore.add(claim);
    await expect(settleReceipt(A, claim)).rejects.toThrow(NONCE_UNVERIFIED);
    expect(pendingStore.list()).toHaveLength(1);
  });

  it("once the sent transaction is readable its actual nonce (11) is reconciled and the real replacement B is found", async () => {
    mockChain({ knowsA: true });
    const saved: PendingTx = { hash: A, kind: "buy", account: ME, quantity: 1, createdAt: Date.now(), from: ME, nonce: 9, block: "100", nonceChecked: false, styles: [0], wishes: ["original"] };
    pendingStore.add(saved);
    const { receipt } = await settleReceipt(A, saved);
    expect(receipt.transactionHash).toBe(B);
    expect(pendingStore.list()[0]).toMatchObject({ nonce: 11, nonceChecked: true });
  });

  it("a verified nonce still recovers a replacement mined while the tab was closed", async () => {
    mockChain();
    const saved: PendingTx = { hash: A, kind: "buy", account: ME, quantity: 1, createdAt: Date.now(), from: ME, nonce: 11, block: "100", nonceChecked: true, styles: [0], wishes: ["original"] };
    pendingStore.add(saved);
    const s = await awaitBuy({ wait: settleBuyReceipt, storage: localStorage, explain: String }, saved, () => {});
    // B is a verified cancel (self-transfer at A's own nonce): nothing bought, the draft is released
    expect(s).toEqual({ name: "error", message: REPLACED_MESSAGE });
    expect(pendingStore.list()).toEqual([]);
  });
});
