// Labelled mocks: ABI-encoded calldata and logs built locally, no chain, fork or wallet.
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, type Hash, type Log } from "viem";
import { wishGardenAbi } from "../src/abi/WishGarden";
import { GARDEN } from "../src/config";
import { decodeBuy, readReceipt, settleClaim, CLAIM_REPLACED } from "../src/lib/receipt";
import { awaitBuy, settleBuy, REPLACED_MESSAGE, type PendingTx } from "../src/lib/purchase";
import { locateMined, type RecoveryClient } from "../src/lib/recovery";

const ME = "0x1111111111111111111111111111111111111111";
const A = ("0x" + "a".repeat(64)) as Hash;
const B = ("0x" + "b".repeat(64)) as Hash;
const buyInput = (styles: number[], wishes: string[]) => encodeFunctionData({ abi: wishGardenAbi, functionName: "buyCandles", args: [styles, wishes] as any });

function purchasedLog(first: bigint, q: bigint, address: string = GARDEN): Log {
  const topics = encodeEventTopics({ abi: wishGardenAbi, eventName: "CandlesPurchased", args: { purchaser: ME, firstCandleId: first } as any });
  return { address, topics, data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [q, q * 10n ** 18n]) } as unknown as Log;
}
function createdLog(id: bigint, style: number, wish: string, address: string = GARDEN): Log {
  const ev = wishGardenAbi.find((x: any) => x.type === "event" && x.name === "CandleCreated") as any;
  const indexed = ev.inputs.filter((i: any) => i.indexed).map((i: any) => i.name);
  const args: any = { candleId: id, purchaser: ME, beneficiary: ME };
  const topics = encodeEventTopics({ abi: wishGardenAbi, eventName: "CandleCreated", args: Object.fromEntries(indexed.map((n: string) => [n, args[n]])) as any });
  const rest = ev.inputs.filter((i: any) => !i.indexed);
  const vals: any = { position: id, style, createdAt: 1n, wish };
  return { address, topics, data: encodeAbiParameters(rest, rest.map((i: any) => (i.type.startsWith("uint") && i.type !== "uint8" ? BigInt(vals[i.name]) : vals[i.name]))) } as unknown as Log;
}
function claimedLog(amount: bigint, who = ME, address: string = GARDEN): Log {
  const topics = encodeEventTopics({ abi: wishGardenAbi, eventName: "RewardsClaimed", args: { beneficiary: who } as any });
  return { address, topics, data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, amount]) } as unknown as Log;
}

const draft = { styles: [2, 5], wishes: ["for the people we love", ""] };
const goodLogs = [purchasedLog(7n, 2n), createdLog(7n, 2, "for the people we love"), createdLog(8n, 5, "")];

describe("replacement purchases are verified against the exact signed draft (mock)", () => {
  it("decodes buyCandles calldata and rejects other calls", () => {
    expect(decodeBuy(buyInput(draft.styles, draft.wishes))).toEqual(draft);
    expect(decodeBuy("0x")).toBeNull();
    expect(decodeBuy("0x12345678")).toBeNull();
  });
  it("accepts a sped-up replacement with identical calldata and events", () => {
    const r = readReceipt({ status: "success", transactionHash: B, logs: goodLogs }, { from: ME, to: GARDEN, input: buyInput(draft.styles, draft.wishes) });
    expect(settleBuy(r, A, ME, 2, draft)).toEqual({ name: "done", hash: B, firstId: 7 });
  });
  it("rejects a replacement that bought with a different wish, style or quantity", () => {
    const wish = readReceipt({ status: "success", transactionHash: B, logs: [purchasedLog(7n, 2n), createdLog(7n, 2, "other"), createdLog(8n, 5, "")] }, { from: ME, to: GARDEN, input: buyInput([2, 5], ["other", ""]) });
    expect(settleBuy(wish, A, ME, 2, draft)).toEqual({ name: "error", message: REPLACED_MESSAGE });
    const style = readReceipt({ status: "success", transactionHash: B, logs: [purchasedLog(7n, 2n), createdLog(7n, 3, draft.wishes[0]), createdLog(8n, 5, "")] }, { from: ME, to: GARDEN, input: buyInput([3, 5], draft.wishes) });
    expect(settleBuy(style, A, ME, 2, draft).name).toBe("error");
    const qty = readReceipt({ status: "success", transactionHash: B, logs: [purchasedLog(7n, 1n), createdLog(7n, 2, draft.wishes[0])] }, { from: ME, to: GARDEN, input: buyInput([2], [draft.wishes[0]]) });
    expect(settleBuy(qty, A, ME, 2, draft).name).toBe("error");
  });
  it("rejects matching events when the calldata differs, and events from another contract", () => {
    const r = readReceipt({ status: "success", transactionHash: B, logs: goodLogs }, { from: ME, to: GARDEN, input: buyInput([2, 5], ["x", ""]) });
    expect(settleBuy(r, A, ME, 2, draft).name).toBe("error");
    const other = "0x2222222222222222222222222222222222222222";
    const f = readReceipt({ status: "success", transactionHash: B, logs: [purchasedLog(7n, 2n, other), createdLog(7n, 2, draft.wishes[0], other)] }, { from: ME, to: other, input: buyInput(draft.styles, draft.wishes) });
    expect(settleBuy(f, A, ME, 2, draft).name).toBe("error");
  });
  it("a zero-value self-transfer cancel never lights candles", () => {
    const r = readReceipt({ status: "success", transactionHash: B, logs: [] }, { from: ME, to: ME, input: "0x" });
    expect(settleBuy(r, A, ME, 2, draft)).toEqual({ name: "error", message: REPLACED_MESSAGE });
  });
  it("awaitBuy passes the saved draft (from a reload) into verification", async () => {
    const tx: PendingTx = { hash: A, kind: "buy", account: ME, quantity: 2, createdAt: 0, from: ME, nonce: 4, block: "100", ...draft };
    const r = readReceipt({ status: "success", transactionHash: B, logs: goodLogs }, { from: ME, to: GARDEN, input: buyInput([2, 5], ["changed", ""]) });
    const s = await awaitBuy({ storage: null, explain: String, wait: async (_h, saved) => { expect(saved?.nonce).toBe(4); return r; } }, tx, () => {});
    expect(s.name).toBe("error");
  });
});

describe("bounded replacement recovery from sender, nonce and submission block (mock client)", () => {
  const tx: PendingTx = { hash: A, kind: "buy", account: ME, createdAt: 0, from: ME, nonce: 4, block: "100" };
  const chain = (minedAt: number | null, hash: Hash, historical = true, head = 160): RecoveryClient & { calls: number } => {
    const c = {
      calls: 0,
      receipt: async (h: Hash) => (minedAt !== null && h === hash && hash === A ? {} : null),
      nonceAt: async (_a: string, b?: bigint) => {
        c.calls++;
        if (b !== undefined && !historical) throw new Error("missing trie node");
        const at = b === undefined ? head : Number(b);
        return minedAt !== null && at >= minedAt ? 5 : 4;
      },
      head: async () => BigInt(head),
      blockTxs: async (b: bigint) => (minedAt !== null && Number(b) === minedAt ? [{ hash: B, from: ME.toUpperCase().replace("0X", "0x"), nonce: 3 }, { hash, from: ME, nonce: 4 }] : []),
    };
    return c;
  };
  it("returns the sent hash when it has its own receipt", async () => {
    expect(await locateMined(chain(120, A), tx)).toEqual({ kind: "mined", hash: A, replaced: false });
  });
  it("stays pending while the nonce is unused", async () => {
    expect(await locateMined(chain(null, B), tx)).toEqual({ kind: "pending" });
  });
  it("binary-searches the block that consumed the nonce and returns the replacement", async () => {
    const c = chain(137, B);
    expect(await locateMined(c, tx)).toEqual({ kind: "mined", hash: B, replaced: true });
    expect(c.calls).toBeLessThan(12);
  });
  it("falls back to a bounded linear scan on nodes without historical state", async () => {
    expect(await locateMined(chain(131, B, false), tx)).toEqual({ kind: "mined", hash: B, replaced: true });
  });
  it("reports unknown when the nonce was used outside the window", async () => {
    expect((await locateMined(chain(900, B, true, 1000), tx, 50n)).kind).toBe("unknown");
  });
  it("reports unknown for an entry saved without sender and nonce", async () => {
    expect((await locateMined(chain(null, B), { hash: A, kind: "buy", account: ME, createdAt: 0 })).kind).toBe("unknown");
  });
});

describe("claims show Claimed only with a verified RewardsClaimed (mock)", () => {
  const claimInput = encodeFunctionData({ abi: wishGardenAbi, functionName: "claimRewards" });
  it("verified claim", () => {
    expect(settleClaim({ status: "success", logs: [claimedLog(5n)] }, { from: ME, to: GARDEN, input: claimInput }, ME)).toEqual({ ok: true, amount: 5n });
  });
  it("cancelled claim (self-transfer replacement) is never Claimed", () => {
    expect(settleClaim({ status: "success", logs: [] }, { from: ME, to: ME, input: "0x" }, ME)).toEqual({ ok: false, message: CLAIM_REPLACED });
  });
  it("claimRewards with no event, an event for someone else or from another contract is not Claimed", () => {
    expect(settleClaim({ status: "success", logs: [] }, { from: ME, to: GARDEN, input: claimInput }, ME).ok).toBe(false);
    expect(settleClaim({ status: "success", logs: [claimedLog(5n, "0x3333333333333333333333333333333333333333")] }, { from: ME, to: GARDEN, input: claimInput }, ME).ok).toBe(false);
    expect(settleClaim({ status: "success", logs: [claimedLog(5n, ME, "0x2222222222222222222222222222222222222222")] }, { from: ME, to: GARDEN, input: claimInput }, ME).ok).toBe(false);
    expect(settleClaim({ status: "reverted", logs: [claimedLog(5n)] }, { from: ME, to: GARDEN, input: claimInput }, ME).ok).toBe(false);
    expect(settleClaim({ status: "success", logs: [claimedLog(5n)] }, null, ME).ok).toBe(false);
  });
});
