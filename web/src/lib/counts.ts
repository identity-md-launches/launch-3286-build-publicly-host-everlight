/**
 * The garden's headline counts. "Lit" is the verified contract totalCandles, never the number of records loaded so
 * far; loaded records are reported separately as "loaded X of Y". An unknown total is "unavailable", never zero.
 */
export interface CountInput { total: number | null; loaded: number; loading: boolean; error: string | null }
export interface CountLine { lit: string; loaded: string | null; incomplete: boolean; retry: boolean }

const n = (x: number) => x.toLocaleString("en-US");

export function countLine(s: CountInput): CountLine {
  if (s.total === null) {
    if (s.error) return { lit: "Total lit: unavailable", loaded: s.loaded > 0 ? `${n(s.loaded)} records loaded` : null, incomplete: true, retry: true };
    return { lit: "Counting candles…", loaded: null, incomplete: false, retry: false };
  }
  const loaded = Math.min(s.loaded, s.total);
  const partial = loaded < s.total;
  return {
    lit: `${n(s.total)} lit`,
    loaded: partial ? `loaded ${n(loaded)} of ${n(s.total)}` : null,
    incomplete: partial && !!s.error,
    retry: !!s.error,
  };
}
