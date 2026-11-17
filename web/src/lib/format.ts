import { formatUnits, getAddress } from "viem";

export const short = (a: string) => {
  const c = safeChecksum(a);
  return `${c.slice(0, 6)}…${c.slice(-4)}`;
};

export function safeChecksum(a: string) {
  try {
    return getAddress(a);
  } catch {
    return a;
  }
}

/** IMD amounts (18 decimals) with up to 4 fractional digits, never rounded up. */
export function imd(v: bigint | undefined | null, digits = 4): string {
  if (v === undefined || v === null) return "…";
  const s = formatUnits(v, 18);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, digits).replace(/0+$/, "");
  const int = Number(i).toLocaleString("en-US");
  return frac ? `${int}.${frac}` : int;
}

export function eth(v: bigint | undefined | null): string {
  if (v === undefined || v === null) return "…";
  const n = Number(formatUnits(v, 18));
  if (n === 0) return "0";
  if (n < 0.00001) return "< 0.00001";
  return n.toLocaleString("en-US", { maximumFractionDigits: 5 });
}

export function date(ts: number | bigint): string {
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const STYLE_NAMES = ["Moon taper", "Ember pillar", "Lantern bloom", "Lily float", "Gilded spiral", "Frog lamp", "Star votive"];
