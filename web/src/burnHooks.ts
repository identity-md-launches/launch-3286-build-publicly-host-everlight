import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { baseClient, ethClient } from "./config";
import { FIXTURE } from "./hooks";
import { POLL_MS, isStale, listOps, readConsistent, reconcile, type BaseSnap, type BurnOp, type EthSnap, type Reconciled } from "./lib/burn";
import { readBaseSnap, readEthSnap } from "./lib/burnio";

export interface BurnView {
  /** Latest reconciliation (may be inconsistent or partial). */
  now?: Reconciled & { attempts: number };
  /** Last fully consistent reconciliation, shown labelled stale when the latest one is not consistent. */
  good?: Reconciled;
  goodAt?: number;
  stale: boolean;
  loading: boolean;
  fetching: boolean;
  refresh: () => void;
}

/** Fixture pages: a labelled, fixed snapshot (no network). */
const fixtureEth: EthSnap = { block: 1n, ts: Math.floor(Date.now() / 1000), readAt: Date.now(), totalBurnAllocated: 54n * 10n ** 17n, burnQueued: 54n * 10n ** 17n, burnReserved: 0n, burnInTransit: 0n, confirmedBurn: 0n, failedBurnAmount: 0n, burnJobCount: 0n, bridgeDust: 0n, owner: "0x0000000000000000000000000000000000000001", activated: true, baseReady: true };
const fixtureBase: BaseSnap = { block: 1n, ts: Math.floor(Date.now() / 1000), readAt: Date.now(), totalReceived: 0n, pendingBurn: 0n, failedBurn: 0n, totalBurned: 0n, activated: true, owner: "0x0000000000000000000000000000000000000001" };

/** One shared poll for the footer and the dashboard (react-query dedupes by key). */
export function useBurn(): BurnView {
  const q = useQuery({
    queryKey: ["burn", FIXTURE],
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: 0,
    queryFn: async () => FIXTURE !== null
      ? { ...reconcile({ ...fixtureEth, readAt: Date.now() }, { ...fixtureBase, readAt: Date.now() }), attempts: 1 }
      : readConsistent(() => readEthSnap(ethClient as any), () => readBaseSnap(baseClient as any)),
  });
  const good = useRef<{ r: Reconciled; at: number } | null>(null);
  if (q.data?.health === "ok" && good.current?.r !== q.data) good.current = { r: q.data, at: q.dataUpdatedAt };
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(t); }, []);
  const g = good.current;
  const latestOk = q.data?.health === "ok";
  return {
    now: q.data,
    good: g?.r,
    goodAt: g?.at,
    stale: !g || !latestOk || isStale(Math.min(g.r.eth!.ts, g.r.base!.ts), g.at),
    loading: q.isLoading,
    fetching: q.isFetching,
    refresh: () => { q.refetch(); },
  };
}

/** Saved burn operations, kept in sync with other tabs through the storage event. */
export function useBurnOps(): [BurnOp[], () => void] {
  const [ops, setOps] = useState<BurnOp[]>(() => listOps());
  useEffect(() => {
    const f = () => setOps(listOps());
    addEventListener("storage", f);
    return () => removeEventListener("storage", f);
  }, []);
  return [ops, () => setOps(listOps())];
}
