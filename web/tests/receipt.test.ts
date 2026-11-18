import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Log } from "viem";
import { wishGardenAbi } from "../src/abi/WishGarden";
import { GARDEN } from "../src/config";
import { readReceipt } from "../src/lib/receipt";

const buyer = "0x1111111111111111111111111111111111111111";
const log = (address: string, first: bigint, qty: bigint) => ({
  address,
  topics: encodeEventTopics({ abi: wishGardenAbi, eventName: "CandlesPurchased", args: { purchaser: buyer, firstCandleId: first } }),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [qty, qty * 10n ** 18n]),
  blockHash: null, blockNumber: null, logIndex: null, transactionHash: null, transactionIndex: null, removed: false,
}) as unknown as Log;

describe("purchase receipts (labelled encoded logs, no chain)", () => {
  const B = `0x${"c3".repeat(32)}` as const;
  it("reads the garden's CandlesPurchased event and the mined hash", () => {
    expect(readReceipt({ status: "success", transactionHash: B, logs: [log(GARDEN, 1n, 3n)] })).toEqual({
      status: "success", hash: B, purchase: { purchaser: buyer, firstId: 1, quantity: 3 },
    });
  });
  it("ignores a look-alike event from another contract and an empty receipt", () => {
    expect(readReceipt({ status: "success", transactionHash: B, logs: [log("0x2222222222222222222222222222222222222222", 1n, 3n)] }).purchase).toBeNull();
    expect(readReceipt({ status: "success", transactionHash: B, logs: [] }).purchase).toBeNull();
  });
});
