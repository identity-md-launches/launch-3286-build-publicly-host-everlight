import { WISH_MAX_BYTES, WISH_MAX_CODEPOINTS } from "../config";

const enc = new TextEncoder();

export interface WishCheck {
  codepoints: number;
  bytes: number;
  ok: boolean;
  error: string | null;
}

/** Mirrors Utf8Wish.validate: strict UTF-8 scalar values, <= 280 code points and <= 1120 bytes. */
export function checkWish(text: string): WishCheck {
  let codepoints = 0;
  let lone = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) i++;
      else lone = true;
    } else if (c >= 0xdc00 && c <= 0xdfff) lone = true;
    codepoints++;
  }
  const bytes = enc.encode(text).length;
  let error: string | null = null;
  if (lone) error = "This wish contains a broken character. Remove it and type it again.";
  else if (codepoints > WISH_MAX_CODEPOINTS)
    error = `Shorten this wish by ${codepoints - WISH_MAX_CODEPOINTS} characters (limit ${WISH_MAX_CODEPOINTS}).`;
  else if (bytes > WISH_MAX_BYTES)
    error = `This wish uses ${bytes} bytes; the limit is ${WISH_MAX_BYTES}. Use fewer emoji or symbols.`;
  return { codepoints, bytes, ok: error === null, error };
}

/** Upper bound from the contract docs: 300,000 + 170,000 per candle + 1,300 per wish byte. */
export function gasBound(candles: number, wishBytes: number): bigint {
  return 300_000n + 170_000n * BigInt(candles) + 1_300n * BigInt(wishBytes);
}
