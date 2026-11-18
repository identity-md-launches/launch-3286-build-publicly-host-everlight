import { MAX_BATCH } from "../config";

export type QuantityResult = { ok: true; n: number } | { ok: false; error: string };

/**
 * Strict quantity: only a whole number from 1 to MAX_BATCH. Nothing is clamped or rounded, so the number
 * typed is exactly the number previewed, totalled, approved and bought; anything else is rejected visibly.
 */
export function parseQuantity(raw: string): QuantityResult {
  const t = raw.trim();
  if (t === "") return { ok: false, error: `Enter how many candles, from 1 to ${MAX_BATCH}.` };
  if (!/^\d+$/.test(t)) return { ok: false, error: `Use a whole number from 1 to ${MAX_BATCH}: no decimals, signs or letters.` };
  const n = Number(t);
  if (n < 1) return { ok: false, error: "At least 1 candle." };
  if (n > MAX_BATCH) return { ok: false, error: `At most ${MAX_BATCH} candles per purchase. Split larger batches.` };
  return { ok: true, n };
}
