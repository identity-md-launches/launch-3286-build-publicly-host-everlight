import type { Address } from "viem";
import { GARDEN, PAGE_SIZE } from "../config";

export interface Candle {
  id: number;
  purchaser: string;
  style: number;
  createdAt: number;
  position: number;
  wish: string;
  /** Hash of the transaction that lit it, once known (purchase receipt or a CandlesPurchased log lookup). */
  txHash?: `0x${string}`;
}

/** Where candles come from: the live contract, or a clearly labelled local fixture. */
export interface CandleSource {
  kind: "live" | "fixture";
  total(): Promise<number>;
  page(firstId: number, limit: number): Promise<Candle[]>;
  /** One record by id (getCandle), for Find when its page has not streamed in yet. */
  one(id: number): Promise<Candle>;
  idsOf(owner: string): Promise<number[]>;
}

export interface StoreState {
  total: number | null;
  candles: Candle[]; // index = id - 1
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
}

/** A page inside the verified total came back empty (or out of order): the register is incomplete. */
export class IncompleteSync extends Error {
  constructor(readonly firstMissing: number, readonly total: number) {
    super(`Candle records from #${firstMissing} of ${total} could not be read yet; the list is incomplete.`);
  }
}

const CACHE_KEY = `everlight:v2:candles:${GARDEN.toLowerCase()}`;

/**
 * Incremental candle index. Reads totalCandles, then pages getCandles(first, 100) only for ids it has
 * not seen, streaming each page to subscribers so new garden sectors appear as they arrive.
 * Live records are cached in localStorage (best effort; quota errors only skip the cache).
 */
export class CandleStore {
  state: StoreState = { total: null, candles: [], loading: false, error: null, updatedAt: null };
  private subs = new Set<() => void>();
  private syncing: Promise<void> | null = null;

  constructor(readonly source: CandleSource, private storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage) {
    if (source.kind === "live") this.restore();
  }

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  }
  private set(p: Partial<StoreState>) {
    this.state = { ...this.state, ...p };
    this.subs.forEach((f) => f());
  }

  private restore() {
    try {
      const raw = this.storage?.getItem(CACHE_KEY);
      if (!raw) return;
      const list = JSON.parse(raw) as Candle[];
      if (Array.isArray(list) && list.every((c, i) => c.id === i + 1)) this.set({ candles: list });
    } catch {
      /* ignore a corrupt cache */
    }
  }
  private persist() {
    if (this.source.kind !== "live") return;
    try {
      this.storage?.setItem(CACHE_KEY, JSON.stringify(this.state.candles));
    } catch {
      /* quota: keep working from memory */
    }
  }

  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      this.set({ loading: true, error: null });
      try {
        const total = await this.source.total();
        let candles = this.state.candles;
        if (candles.length > total) candles = []; // a different deployment or a reset fixture
        this.set({ total, candles });
        let next = candles.length + 1;
        while (next <= total) {
          const limit = Math.min(PAGE_SIZE, total - next + 1);
          const page = await this.source.page(next, limit);
          // totalCandles and getCandles are separate latest-block reads, so an RPC serving an older snapshot can
          // return a valid empty page for ids the verified total already covers: that is incomplete data, not the
          // end of the register. Keep the total and every earlier record, and let Retry resume at this id.
          if (page.length === 0) throw new IncompleteSync(next, total);
          // only consecutive ids are accepted, so a retry always resumes with the first missing one
          const fresh = page.filter((c, i) => c.id === next + i).slice(0, limit);
          if (fresh.length === 0) throw new IncompleteSync(next, total);
          this.set({ candles: [...this.state.candles, ...fresh] });
          next += fresh.length;
        }
        this.persist();
        this.set({ loading: false, updatedAt: Date.now() });
      } catch (e) {
        if (e instanceof IncompleteSync) this.persist(); // the records that did load are still good
        this.set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  get(id: number): Candle | undefined {
    return this.state.candles[id - 1];
  }

  /**
   * Find support: the record for id from the streamed index, or a direct getCandle read when its page
   * has not arrived (or failed). Existence is decided by the onchain total, not by how many are loaded.
   */
  async lookup(id: number): Promise<{ kind: "found"; candle: Candle } | { kind: "none"; total: number }> {
    const have = this.state.candles[id - 1];
    if (have) return { kind: "found", candle: have };
    const total = this.state.total ?? (await this.source.total());
    if (id > total) return { kind: "none", total };
    return { kind: "found", candle: await this.source.one(id) };
  }
}

/**
 * The owner's register ended before the verified onchain count: the IDs read so far are valid and kept, and a retry
 * resumes at the first missing offset. Never shown as a complete register.
 */
export class IncompleteIdsError extends Error {
  constructor(public ids: number[], public expected: number, public nextOffset: bigint) {
    super(`Only ${ids.length} of your ${expected} candles could be read; the rest did not arrive.`);
    this.name = "IncompleteIdsError";
  }
}

/**
 * Paginate candleIdsOf(owner, offset, 100). With `expected` (candleCountOf, read at the same block where the client
 * allows it) the pages are reconciled with that count: an empty, short or stalled page before the count is reached
 * throws IncompleteIdsError carrying the IDs read and the first missing offset. `from` resumes an earlier partial read.
 */
export async function readAllIds(
  read: (offset: bigint, limit: bigint) => Promise<readonly [readonly bigint[], bigint]>,
  expected?: number,
  from: { ids: number[]; offset: bigint } = { ids: [], offset: 0n },
): Promise<number[]> {
  const out: number[] = [...from.ids];
  let offset = from.offset;
  for (let guard = 0; guard < 10_000; guard++) {
    if (expected !== undefined && out.length >= expected) break;
    const [ids, nextOffset] = await read(offset, BigInt(PAGE_SIZE));
    out.push(...ids.map(Number));
    const end = ids.length < PAGE_SIZE || nextOffset === offset;
    const reached = offset + BigInt(ids.length);
    if (end) {
      if (expected !== undefined && out.length < expected) throw new IncompleteIdsError(out, expected, reached);
      break;
    }
    offset = nextOffset > reached ? reached : nextOffset;
  }
  return expected !== undefined ? out.slice(0, expected) : out;
}

export function liveSource(client: {
  readContract: (args: any) => Promise<any>;
  getBlockNumber?: () => Promise<bigint>;
}, abi: readonly unknown[]): CandleSource {
  const read = (functionName: string, args: unknown[] = [], blockNumber?: bigint) =>
    client.readContract(blockNumber === undefined ? { address: GARDEN, abi, functionName, args } : { address: GARDEN, abi, functionName, args, blockNumber });
  /** Partial owner registers kept for a retry that resumes at the first missing offset (same verified count only). */
  const partial = new Map<string, { count: number; ids: number[]; offset: bigint }>();
  return {
    kind: "live",
    async total() {
      return Number(await read("totalCandles"));
    },
    async page(firstId, limit) {
      const [records] = (await read("getCandles", [BigInt(firstId), BigInt(limit)])) as [any[], bigint];
      return records.map((r, i) => ({
        id: firstId + i,
        purchaser: r.purchaser as string,
        style: Number(r.style),
        createdAt: Number(r.createdAt),
        position: Number(r.position),
        wish: r.wish as string,
      }));
    },
    async one(id) {
      const r = (await read("getCandle", [BigInt(id)])) as any;
      return { id, purchaser: r.purchaser as string, style: Number(r.style), createdAt: Number(r.createdAt), position: Number(r.position), wish: r.wish as string };
    },
    async idsOf(owner) {
      const key = owner.toLowerCase();
      // count and pages from one block where the client allows it, so the count verifies exactly these pages
      let block: bigint | undefined;
      try { block = client.getBlockNumber ? await client.getBlockNumber() : undefined; } catch { block = undefined; }
      const count = Number(await read("candleCountOf", [owner as Address], block));
      if (count === 0) { partial.delete(key); return []; }
      const prev = partial.get(key);
      const from = prev && prev.count === count ? { ids: prev.ids, offset: prev.offset } : undefined;
      try {
        const ids = await readAllIds((o, l) => read("candleIdsOf", [owner as Address, o, l], block), count, from);
        partial.delete(key);
        return ids;
      } catch (e) {
        if (e instanceof IncompleteIdsError) partial.set(key, { count, ids: e.ids, offset: e.nextOffset });
        throw e;
      }
    },
  };
}

/** Deterministic test fixture. Labelled in the UI; never mixed with live data. */
export function fixtureSource(n: number, mine?: string): CandleSource {
  const owners = [
    mine ?? "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444",
  ];
  const wishes = [
    "",
    "May the garden keep every light we cannot.",
    '<img src=x onerror="alert(1)"> should appear as plain text',
    "<script>alert('xss')</script>",
    "For Mira, who loved frogs and moonlight 🐸🌙",
    "عسى أن يبقى النور",
    "願いが叶いますように",
    "x".repeat(280),
  ];
  const start = 1_731_800_000;
  const all: Candle[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    purchaser: owners[(i * 7 + (i >> 3)) % owners.length],
    style: (i * 5 + (i >> 2)) % 7,
    createdAt: start + i * 431,
    position: i,
    wish: wishes[(i * 3) % wishes.length],
  }));
  return {
    kind: "fixture",
    async total() {
      return n;
    },
    async page(firstId, limit) {
      if (limit < 1 || limit > PAGE_SIZE) throw new Error("InvalidPage");
      return all.slice(firstId - 1, firstId - 1 + limit);
    },
    async one(id) {
      const c = all[id - 1];
      if (!c) throw new Error("CandleNotFound");
      return c;
    },
    async idsOf(owner) {
      return all.filter((c) => c.purchaser.toLowerCase() === owner.toLowerCase()).map((c) => c.id);
    },
  };
}
