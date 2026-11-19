import { MAX_BATCH, TX_GAS_CAP } from "../config";
import { gasBound } from "./wish";
import { parseQuantity } from "./quantity";

const enc = new TextEncoder();
export interface Item { style: number; wish: string }
export interface Batch { start: number; items: Item[]; bound: bigint }

/**
 * Split a draft into ordered purchases. Each purchase keeps the draft's order (earlier candles get earlier IDs),
 * holds at most MAX_BATCH candles, and its documented gas upper bound (300,000 + 170,000 per candle + 1,300 per
 * wish byte) stays within one transaction's gas cap. Every purchase is confirmed separately in the wallet.
 */
export function planBatches(items: Item[], cap: bigint = TX_GAS_CAP, max = MAX_BATCH, firstMax?: number): Batch[] {
  const out: Batch[] = [];
  let cur: Item[] = [], bytes = 0, start = 0;
  items.forEach((it, i) => {
    const b = enc.encode(it.wish).length;
    // firstMax: the contract's own gas estimate showed only that many leading candles fit the next purchase
    const lim = out.length === 0 && firstMax !== undefined && firstMax > 0 ? Math.min(max, firstMax) : max;
    if (cur.length > 0 && (cur.length >= lim || gasBound(cur.length + 1, bytes + b) > cap)) {
      out.push({ start, items: cur, bound: gasBound(cur.length, bytes) });
      cur = []; bytes = 0; start = i;
    }
    cur.push(it); bytes += b;
  });
  if (cur.length) out.push({ start, items: cur, bound: gasBound(cur.length, bytes) });
  return out;
}

/**
 * Largest ordered prefix (1..n-1) whose estimate fits, by binary search over `fits(k)` (an estimate in gas, or null
 * when it is above the cap or the RPC refuses it for gas). Returns 0 when not even one candle fits.
 */
export async function fittingPrefix(n: number, fits: (k: number) => Promise<bigint | null>): Promise<{ n: number; est: bigint | null }> {
  let lo = 0, hi = n - 1, est: bigint | null = null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const e = await fits(mid);
    if (e !== null) { lo = mid; est = e; } else hi = mid - 1;
  }
  if (lo > 0 && est === null) est = await fits(lo);
  return { n: lo, est };
}

/** The saved purchase form (session storage). */
export interface SavedDraft { preset?: number; custom?: string; mode?: "same" | "each"; style?: number; wish?: string; rows?: Item[] }
export const DRAFT_KEY = "everlight:draft";

/** The ordered items a saved form stands for (mirrors LightPanel's `items`). */
export function draftItems(d: SavedDraft, qty: number): Item[] {
  const style = typeof d.style === "number" ? d.style : 0, wish = typeof d.wish === "string" ? d.wish : "";
  if (!(d.mode === "each" && qty > 1)) return Array.from({ length: qty }, () => ({ style, wish }));
  const rows = Array.isArray(d.rows) ? d.rows : [];
  return Array.from({ length: qty }, (_, i) => rows[i] ?? { style, wish: "" });
}

/**
 * A confirmed purchase removes exactly its candles from the front of the saved draft and keeps the rest, so a
 * split draft continues with the next purchase (also after a reload). Returns the remaining draft, or null when
 * nothing is left (the draft is cleared). If the confirmed candles are not the draft's leading items the draft is
 * left as it is.
 */
export function consumeDraft(d: SavedDraft, qty: number, styles: number[], wishes: string[]): SavedDraft | null {
  const items = draftItems(d, qty);
  const n = styles.length;
  const prefix = n <= items.length && styles.every((s, i) => items[i].style === s && items[i].wish === wishes[i]);
  if (!prefix) return d;
  const rest = items.slice(n);
  if (rest.length === 0) return null;
  const same = rest.every((r) => r.style === rest[0].style && r.wish === rest[0].wish);
  if (same) return { ...d, mode: "same", custom: String(rest.length), style: rest[0].style, wish: rest[0].wish, rows: [] };
  return { ...d, mode: "each", custom: String(rest.length), rows: rest };
}

function quantityOf(d: SavedDraft): number {
  if (typeof d.custom === "string" && d.custom !== "") {
    const q = parseQuantity(d.custom);
    return q.ok ? q.n : 0;
  }
  return typeof d.preset === "number" ? d.preset : 1;
}

/** Apply a confirmed purchase to the draft saved in session storage. */
export function consumeSavedDraft(styles: number[], wishes: string[], storage: Storage | null = session()): void {
  if (!storage) return;
  try {
    const d: SavedDraft = JSON.parse(storage.getItem(DRAFT_KEY) ?? "{}");
    const next = consumeDraft(d, quantityOf(d), styles, wishes);
    if (next === null) storage.removeItem(DRAFT_KEY);
    else storage.setItem(DRAFT_KEY, JSON.stringify(next));
  } catch { /* private mode: the in-page form is updated from the same rule */ }
}

function session(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}
