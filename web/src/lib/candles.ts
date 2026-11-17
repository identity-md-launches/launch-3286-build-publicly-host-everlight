import type { Address } from "viem";
import { GARDEN, PAGE_SIZE } from "../config";

export interface Candle {
  id: number;
  purchaser: string;
  style: number;
  createdAt: number;
  position: number;
  wish: string;
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

const CACHE_KEY = `everlight:v1:candles:${GARDEN.toLowerCase()}`;

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
          if (page.length === 0) break;
          this.set({ candles: [...this.state.candles, ...page] });
          next += page.length;
        }
        this.persist();
        this.set({ loading: false, updatedAt: Date.now() });
      } catch (e) {
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

/** Paginate candleIdsOf(owner, offset, 100) until the contract returns the end offset. */
export async function readAllIds(
  read: (offset: bigint, limit: bigint) => Promise<readonly [readonly bigint[], bigint]>,
): Promise<number[]> {
  const out: number[] = [];
  let offset = 0n;
  for (let guard = 0; guard < 10_000; guard++) {
    const [ids, nextOffset] = await read(offset, BigInt(PAGE_SIZE));
    out.push(...ids.map(Number));
    if (ids.length < PAGE_SIZE || nextOffset === offset) break;
    offset = nextOffset;
  }
  return out;
}

export function liveSource(client: {
  readContract: (args: any) => Promise<any>;
}, abi: readonly unknown[]): CandleSource {
  const read = (functionName: string, args: unknown[] = []) => client.readContract({ address: GARDEN, abi, functionName, args });
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
      const count = Number(await read("candleCountOf", [owner as Address]));
      if (count === 0) return [];
      return readAllIds((o, l) => read("candleIdsOf", [owner as Address, o, l]));
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
