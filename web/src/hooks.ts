import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, parseAbiItem, type Address } from "viem";
import { wishGardenAbi } from "./abi/WishGarden";
import { burnReceiverAbi } from "./abi/EverlightBurnReceiver";
import { BASE_RECEIVER, GARDEN, GARDEN_DEPLOY_BLOCK, IMD, baseClient, ethClient } from "./config";
import { CandleStore, fixtureSource, liveSource, type Candle } from "./lib/candles";
import { findCandleTx, knownTx, rememberTx } from "./lib/txhash";

const params = new URLSearchParams(location.search);
/** ?fixture=0|100|3000|10000 renders a labelled local fixture instead of live candles (testing only). */
export const FIXTURE: number | null = params.has("fixture") ? Math.max(0, Math.min(20000, Number(params.get("fixture")) || 0)) : null;

export const store = new CandleStore(FIXTURE === null ? liveSource(ethClient, wishGardenAbi) : fixtureSource(FIXTURE));

export function useCandles() {
  const s = useSyncExternalStore((f) => store.subscribe(f), () => store.state);
  useEffect(() => {
    store.sync();
    const t = setInterval(() => store.sync(), 30_000); // incremental: only new ids are fetched
    return () => clearInterval(t);
  }, []);
  return s;
}

const g = { address: GARDEN, abi: wishGardenAbi } as const;

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const [activated, paused, total] = await ethClient.multicall({
        allowFailure: false,
        contracts: [
          { ...g, functionName: "activated" },
          { ...g, functionName: "purchasesPaused" },
          { ...g, functionName: "totalCandles" },
        ],
      });
      return { activated, paused, total: Number(total), open: activated && !paused, at: Date.now() };
    },
  });
}

export function useMyIds(address?: string) {
  return useQuery({
    queryKey: ["mine", address, FIXTURE],
    enabled: !!address,
    queryFn: () => store.source.idsOf(address!),
    refetchInterval: 60_000,
  });
}

export function useWallet(address?: Address) {
  return useQuery({
    queryKey: ["wallet", address],
    enabled: !!address,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [balance, allowance, eth] = await Promise.all([
        ethClient.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [address!] }),
        ethClient.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [address!, GARDEN] }),
        ethClient.getBalance({ address: address! }),
      ]);
      return { balance, allowance, eth };
    },
  });
}

export function useRewards(address?: Address) {
  return useQuery({
    queryKey: ["rewards", address],
    enabled: !!address,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [candles, earned, claimed, claimable, fractionScaled] = await ethClient.readContract({
        ...g, functionName: "rewardState", args: [address!],
      });
      return { candles, earned, claimed, claimable, fractionScaled };
    },
  });
}

export function useGasPrice() {
  return useQuery({ queryKey: ["gas"], refetchInterval: 30_000, queryFn: () => ethClient.getGasPrice() });
}

const TREASURY_FIELDS = [
  "totalPayments", "totalCandles", "ecosystemBalance", "operationsBalance", "founderBalance",
  "totalEcosystemWithdrawn", "totalOperationsWithdrawn", "totalFounderWithdrawn",
  "totalRewardsAllocated", "totalRewardsClaimed", "rewardLiability", "rewardPerCandle",
  "totalBurnAllocated", "burnQueued", "burnReserved", "burnInTransit", "failedBurnAmount", "confirmedBurn",
  "burnJobCount", "totalSendFailures", "unallocatedBalance", "activated", "purchasesPaused", "baseReady", "owner",
] as const;

export function useTreasury() {
  return useQuery({
    queryKey: ["treasury"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await ethClient.multicall({
        allowFailure: true,
        contracts: [
          ...TREASURY_FIELDS.map((functionName) => ({ ...g, functionName }) as const),
          { address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [GARDEN] } as const,
        ] as any,
      });
      const eth: Record<string, unknown> = {};
      TREASURY_FIELDS.forEach((f, i) => (eth[f] = res[i].status === "success" ? res[i].result : undefined));
      const held = res[TREASURY_FIELDS.length];
      eth.heldIMD = held?.status === "success" ? held.result : undefined;
      let baseState: Record<string, bigint | undefined> | null = null;
      try {
        const b = (await baseClient.multicall({
          allowFailure: true,
          contracts: (["totalReceived", "pendingBurn", "failedBurn", "totalBurned"] as const).map((functionName) => ({
            address: BASE_RECEIVER, abi: burnReceiverAbi, functionName,
          })) as any,
        })) as any[];
        baseState = {
          totalReceived: b[0].result as bigint | undefined,
          pendingBurn: b[1].result as bigint | undefined,
          failedBurn: b[2].result as bigint | undefined,
          totalBurned: b[3].result as bigint | undefined,
        };
      } catch {
        baseState = null;
      }
      return { eth: eth as Record<(typeof TREASURY_FIELDS)[number] | "heldIMD", any>, base: baseState, at: Date.now() };
    },
  });
}

const EVENTS = [
  parseAbiItem("event CandlesPurchased(address indexed purchaser, uint256 indexed firstCandleId, uint256 quantity, uint256 totalIMD)"),
  parseAbiItem("event RewardsClaimed(address indexed beneficiary, uint256 amount, uint256 cumulativeClaimed)"),
  parseAbiItem("event BurnQueued(uint256 indexed jobId, uint256 amount)"),
  parseAbiItem("event BurnDispatched(uint256 indexed jobId, bytes32 indexed guid, uint256 amount, uint32 attempt)"),
  parseAbiItem("event BurnConfirmed(uint256 indexed jobId, bytes32 indexed guid, uint256 amount)"),
  parseAbiItem("event BucketWithdrawn(uint8 indexed bucket, address indexed caller, address indexed destination, uint256 amount)"),
];

/** Recent treasury activity: bounded getLogs windows (5,000 blocks, at most 8 windows back from head). */
export function useActivity() {
  return useQuery({
    queryKey: ["activity"],
    refetchInterval: 120_000,
    queryFn: async () => {
      const head = await ethClient.getBlockNumber();
      const out: { name: string; block: bigint; tx: string; args: any }[] = [];
      let to = head;
      let reachedDeploy = false;
      for (let i = 0; i < 8 && to >= GARDEN_DEPLOY_BLOCK && out.length < 50; i++) {
        const from = to - 4_999n > GARDEN_DEPLOY_BLOCK ? to - 4_999n : GARDEN_DEPLOY_BLOCK;
        const logs = await ethClient.getLogs({ address: GARDEN, events: EVENTS, fromBlock: from, toBlock: to });
        for (const l of logs.reverse()) {
          out.push({ name: l.eventName, block: l.blockNumber!, tx: l.transactionHash!, args: l.args });
          if (l.eventName === "CandlesPurchased" && l.transactionHash) rememberTx(Number((l.args as any).firstCandleId), Number((l.args as any).quantity), l.transactionHash);
        }
        if (from === GARDEN_DEPLOY_BLOCK) { reachedDeploy = true; break; }
        to = from - 1n;
      }
      // complete only when every block back to the garden's deployment was read; an empty partial scan is not "no activity"
      const scannedFrom = reachedDeploy ? GARDEN_DEPLOY_BLOCK : to + 1n;
      return { items: out.slice(0, 50), complete: reachedDeploy, scannedFrom, scannedBlocks: head - scannedFrom + 1n, head };
    },
  });
}

export function useReducedMotion() {
  const q = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)"), []);
  const [v, setV] = useState(q.matches);
  useEffect(() => {
    const f = () => setV(q.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [q]);
  return v;
}

/** The transaction that lit a live candle: its own txHash, a remembered receipt/log, or a CandlesPurchased lookup. */
export function useCandleTx(c: Candle) {
  return useQuery({
    queryKey: ["candle-tx", c.id, c.purchaser],
    enabled: FIXTURE === null,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => c.txHash ?? knownTx(c.id) ?? (await findCandleTx(ethClient as any, c)),
  });
}
