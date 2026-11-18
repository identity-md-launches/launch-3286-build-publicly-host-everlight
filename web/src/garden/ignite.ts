/**
 * One-shot ignition of candles that a verified purchase receipt just created. Only the purchase flow and the
 * reload recovery call ignite(), after the receipt and its CandlesPurchased/CandleCreated events are verified;
 * fixture loading and cached records never do, so established candles are always drawn fully lit.
 */
export const IGNITE_MS = 1800;
const starts = new Map<number, number>();

/** Start the ignition of these candle ids now (performance.now() time base, the same as requestAnimationFrame). */
export function ignite(ids: number[], now = performance.now()) {
  for (const id of ids) starts.set(id, now);
}

/** Ignition progress of a candle at `now`: 0 = unlit holder, 1 = fully lit (also for any candle not igniting). */
export function ignition(id: number, now: number): number {
  const s = starts.get(id);
  if (s === undefined) return 1;
  const p = (now - s) / IGNITE_MS;
  if (p >= 1) {
    starts.delete(id);
    return 1;
  }
  return Math.max(0, p);
}

/** Whether any ignition is still running (the render loop keeps drawing until it finishes). */
export const igniting = () => starts.size > 0;

/** Ids lit by a verified purchase: firstId .. firstId + quantity - 1. */
export const newIds = (firstId: number, quantity: number) => Array.from({ length: Math.max(1, quantity) }, (_, i) => firstId + i);
