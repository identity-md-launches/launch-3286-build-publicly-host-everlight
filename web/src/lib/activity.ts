/**
 * Recent treasury activity: a bounded, newest-first eth_getLogs scan that survives the limits of keyless RPCs.
 *
 * - Each host is asked directly (no stacked transport retries), in order, so one host's answer is never hidden
 *   behind another's.
 * - A window is first read whole (5,000 blocks). A host that rejects the range ("ranges over 100 blocks",
 *   "limited to 0 - 50 blocks") is remembered with its limit; when no host can read the whole window, the window
 *   is re-read in chunks of at most 50 blocks, newest first.
 * - A host that refuses archive data (HTTP 403 "Archive requests require a personal token") is skipped for that
 *   window and every older one; a host with a network failure is skipped for the rest of the scan.
 * - Every request counts against one fixed budget. When the budget runs out, or no host can read a range, the scan
 *   stops and returns what it verified: a contiguous block range ending at the head, with the reason it stopped.
 *   Earlier successful windows are never discarded. Only a scan that verified no block at all throws.
 */

export interface LogReader<L> {
  name: string;
  getLogs(fromBlock: bigint, toBlock: bigint): Promise<L[]>;
}

export interface ScanOptions<L> {
  head: bigint;
  deployBlock: bigint;
  readers: LogReader<L>[];
  windowSize?: bigint;
  chunkSize?: bigint;
  maxWindows?: number;
  /** total eth_getLogs requests this scan may make, across all hosts */
  budget?: number;
  /** stop early once this many logs are collected (the panel shows 50) */
  maxItems?: number;
}

export interface ScanResult<L> {
  logs: L[];
  head: bigint;
  /** lowest block of the verified range; every block from here to head was read */
  scannedFrom: bigint;
  scannedBlocks: bigint;
  /** the verified range reaches the garden's deployment block */
  complete: boolean;
  /** why the scan stopped before its planned range, or null when it covered the plan */
  stopped: null | { reason: "budget" | "unavailable"; detail: string };
  requests: number;
}

type Kind = "range" | "archive" | "network" | "other";

const text = (e: unknown): string => {
  const parts: string[] = [];
  let cur: any = e;
  for (let i = 0; cur && i < 5; i++) {
    for (const k of ["shortMessage", "details", "message"]) if (typeof cur[k] === "string") parts.push(cur[k]);
    if (typeof cur.status === "number") parts.push(`HTTP ${cur.status}`);
    cur = cur.cause;
  }
  return parts.join(" | ");
};

export function classify(e: unknown): { kind: Kind; limit: bigint | null; message: string } {
  const m = text(e);
  if (/archive|personal token|pruned|missing trie|state (is )?not available/i.test(m)) return { kind: "archive", limit: null, message: m };
  if (/range|blocks? (are )?not supported|limited to|too (many|large|wide)|exceed|max(imum)?[^|]{0,30}block|more than \d+ (results|logs)|block span/i.test(m)) {
    // "ranges over 100 blocks", "limited to 0 - 50 blocks range": the smallest positive number before "block"
    const nums = [...m.matchAll(/(\d[\d,]*)\s*(?:-\s*(\d[\d,]*)\s*)?blocks?/gi)]
      .flatMap((x) => [x[2], x[1]])
      .filter(Boolean)
      .map((s) => Number(s!.replace(/,/g, "")))
      .filter((n) => n > 0 && n < 1_000_000);
    return { kind: "range", limit: nums.length ? BigInt(Math.min(...nums)) : null, message: m };
  }
  if (/HTTP (403|401|429)|forbidden|unauthori[sz]ed|rate limit|too many requests/i.test(m)) return { kind: "archive", limit: null, message: m };
  if (/fetch|network|timed? ?out|timeout|abort|ECONN|socket|failed to fetch|CORS|HTTP 5\d\d/i.test(m)) return { kind: "network", limit: null, message: m };
  return { kind: "other", limit: null, message: m };
}

class Stop extends Error {
  constructor(public reason: "budget" | "unavailable", detail: string) { super(detail); }
}

export async function scanActivity<L>(o: ScanOptions<L>): Promise<ScanResult<L>> {
  const windowSize = o.windowSize ?? 5_000n, chunk = o.chunkSize ?? 50n;
  const maxWindows = o.maxWindows ?? 8, budget = o.budget ?? 48, maxItems = o.maxItems ?? 50;
  const hosts = o.readers.map((r) => ({ r, limit: null as bigint | null, archiveAt: null as bigint | null, dead: false, last: "" }));
  let requests = 0;
  const logs: L[] = [];
  let verifiedFrom = o.head + 1n; // nothing verified yet
  let stopped: ScanResult<L>["stopped"] = null;

  const usable = (from: bigint, to: bigint, size = to - from + 1n) =>
    hosts.filter((h) => !h.dead && (h.archiveAt === null || to > h.archiveAt) && (h.limit === null || size <= h.limit));

  /** One range, whole, from the first host that answers; false when every usable host rejected only the size. */
  const readWhole = async (from: bigint, to: bigint): Promise<L[] | "too-large"> => {
    let sizeRejected = false;
    for (const h of usable(from, to)) {
      if (requests >= budget) throw new Stop("budget", `the ${budget}-request budget for one scan was used`);
      requests++;
      try {
        return await h.r.getLogs(from, to);
      } catch (e) {
        const c = classify(e);
        h.last = `${h.r.name}: ${c.message.slice(0, 140)}`;
        if (c.kind === "range") { h.limit = c.limit !== null && c.limit < to - from + 1n ? c.limit : to - from; sizeRejected = true; }
        else if (c.kind === "archive") h.archiveAt = to;
        else h.dead = true;
      }
    }
    if (sizeRejected || hosts.some((h) => !h.dead && (h.archiveAt === null || to > h.archiveAt) && h.limit !== null && h.limit < to - from + 1n)) return "too-large";
    const why = hosts.map((h) => h.last).filter(Boolean).join("; ");
    throw new Stop("unavailable", why || "no RPC host can read these blocks");
  };

  try {
    let to = o.head;
    for (let w = 0; w < maxWindows && to >= o.deployBlock && logs.length < maxItems; w++) {
      const from = to - windowSize + 1n > o.deployBlock ? to - windowSize + 1n : o.deployBlock;
      const whole = await readWhole(from, to);
      if (whole !== "too-large") {
        logs.push(...whole.slice().reverse());
        verifiedFrom = from;
      } else {
        // narrow: newest chunk first, so the verified range stays contiguous from the head
        for (let cTo = to; cTo >= from && logs.length < maxItems; ) {
          const cFrom = cTo - chunk + 1n > from ? cTo - chunk + 1n : from;
          const part = await readWhole(cFrom, cTo);
          if (part === "too-large") throw new Stop("unavailable", "no RPC host accepts even a 50-block range");
          logs.push(...part.slice().reverse());
          verifiedFrom = cFrom;
          cTo = cFrom - 1n;
        }
      }
      to = verifiedFrom - 1n;
    }
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    stopped = { reason: e.reason, detail: e.message };
  }
  if (verifiedFrom > o.head) throw new Error(`Recent activity could not be read: ${stopped?.detail ?? "no blocks were read"}`);
  return {
    logs,
    head: o.head,
    scannedFrom: verifiedFrom,
    scannedBlocks: o.head - verifiedFrom + 1n,
    complete: verifiedFrom <= o.deployBlock,
    stopped,
    requests,
  };
}
