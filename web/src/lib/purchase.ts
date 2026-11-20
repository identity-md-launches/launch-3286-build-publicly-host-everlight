import type { Hash } from "viem";
import { GARDEN, IMD } from "../config";
import { imd } from "./format";
import { intentHash, isProvenRejection } from "./intent";

export type TxKind = "approve" | "buy" | "claim";

export interface PendingTx {
  hash: Hash;
  kind: TxKind;
  account: string;
  quantity?: number;
  createdAt: number;
  /** Sender, nonce and the block current at submission: bound the search for a replacement after a reload. */
  from?: string;
  nonce?: number;
  block?: string;
  /**
   * True once sender and nonce were read from the submitted transaction itself (by its hash). Until then they are
   * the preflight values read just before the wallet signed, and recovery re-reads the sent hash to reconcile them.
   */
  nonceChecked?: boolean;
  /** The exact draft that was signed (buy only): a replacement must carry the same calldata and events. */
  styles?: number[];
  wishes?: string[];
  /**
   * A recovery intent saved before the wallet is asked to sign: the exact draft, sender, nonce and submission block,
   * with a placeholder hash of the same length (so saving the real hash later needs no extra space). A reload that
   * finds it keeps the form locked and resolves the purchase from the sender's nonce before another send.
   */
  intent?: boolean;
  /** Durable id of the attempt this entry belongs to (see attemptOf). */
  attempt?: string;
  /** Approval intents: the chain, token, spender and exact amount (wei, decimal string) the wallet was asked to approve. */
  chainId?: number;
  token?: string;
  spender?: string;
  amount?: string;
}

/**
 * Legacy placeholder hash of a recovery intent saved by earlier builds under one key for every account. New intents
 * are saved per account under intentHash("buy", account); a legacy entry is still honoured (and released) only for
 * the account that wrote it.
 */
export const INTENT_HASH = `0x${"0".repeat(64)}` as Hash;

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** A saved purchase or purchase intent of this account: the duplicate guard and the exclusive save match exactly these. */
export const buyConflict = (account: string) => (t: PendingTx) => (t.kind === "buy" || t.kind === "approve") && sameAddr(t.account, account);
/** The placeholder hash this account's purchase intent is saved under. */
export const buyIntentHash = (account: string) => intentHash("buy", account);

/**
 * Durable attempt id. Every approval, purchase and claim attempt gets one when it starts; its intent, its sent hash and
 * any matched replacement keep the same id. Receipts, rejection handlers and delayed callbacks update or remove only
 * entries carrying their own id, so they can never erase a newer attempt (another tab's, or a later one in this tab).
 * Entries saved by earlier builds have no id: they get a stable one derived from their own fields.
 */
export const attemptOf = (t: PendingTx): string => t.attempt ?? `legacy:${t.kind}:${t.account.toLowerCase()}:${t.hash.toLowerCase()}:${t.createdAt}`;
export function newAttemptId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* insecure context */ }
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
/** Remove one attempt (and nothing else). Kept under its old name for the panels: only this attempt's entry goes. */
export function removeBuyIntent(tx: PendingTx, storage: Storage | null = safeStorage()) {
  pendingStore.removeAttempt(attemptOf(tx), storage);
}

// v2: scoped to the live garden, so a transaction sent to an earlier contract is never re-attached here
const PENDING_KEY = "everlight:v2:pending:0x33a514c5e2028f1affd70b82f170e8193df030a5";
/**
 * Storage layout (atomic across tabs without a shared read-modify-write): every attempt is saved under its OWN key,
 * `${PENDING_KEY}:a:<attempt id>`. Saving, updating or removing one attempt never reads or rewrites another attempt's
 * value, so a delayed cleanup computed in tab A can never erase the newer attempt tab B saved (the lost-update race of
 * one shared list is structurally impossible). A settled attempt leaves a tombstone `${PENDING_KEY}:x:<id>` written
 * BEFORE its entry is removed; a compare-and-update writes, then re-checks the tombstone and withdraws its own write if
 * the attempt settled meanwhile, so a delayed callback can never resurrect a settled attempt in any interleaving.
 * Entries written by earlier builds as one list under PENDING_KEY are migrated to their own keys on the next write.
 */
const ATTEMPT_PREFIX = `${PENDING_KEY}:a:`;
const TOMB_PREFIX = `${PENDING_KEY}:x:`;
const TOMB_TTL = 7 * 24 * 3600_000;
const attemptKey = (id: string) => ATTEMPT_PREFIX + id;
const tombKey = (id: string) => TOMB_PREFIX + id;
const pendingSubs = new Set<() => void>();
let pendingVersion = 0;
const pendingChanged = () => { pendingVersion++; pendingSubs.forEach((f) => f()); };
// another tab saving or settling a transaction updates this tab's locks at once (claims, purchases, intents)
try {
  if (typeof window !== "undefined") window.addEventListener("storage", (e) => { if (e.key === null || e.key.startsWith(PENDING_KEY)) pendingChanged(); });
} catch { /* no window */ }
/** The legacy single-list key (earlier builds); also the prefix of every per-attempt key. */
export const PENDING_STORAGE_KEY = PENDING_KEY;

/**
 * Memory fallback, per storage object: ONLY entries whose save failed (quota, blocked storage). Storage that saved
 * successfully is authoritative: an entry that was saved and later settled (here or in another tab) is never merged
 * back from memory. A successful save or a removal of an attempt drops its fallback copy.
 */
const unsaved = new WeakMap<object, { tx: PendingTx; overlay: boolean }[]>();
const NO_STORAGE = {};
const memFor = (storage: Storage | null) => {
  const k = storage ?? NO_STORAGE;
  let l = unsaved.get(k);
  if (!l) unsaved.set(k, (l = []));
  return l;
};
const dropMem = (storage: Storage | null, attempt: string) => {
  const m = memFor(storage);
  for (let i = m.length - 1; i >= 0; i--) if (attemptOf(m[i].tx) === attempt) m.splice(i, 1);
};
/**
 * A failed write. overlay: the attempt was already saved (e.g. its intent) and this newer version (its sent hash)
 * could not replace it. An overlay is shown over the saved entry only while that entry is still saved; once storage
 * no longer has the attempt (settled or matched in another tab) the overlay is dropped, never resurrected.
 */
const keepMem = (storage: Storage | null, tx: PendingTx) => {
  const id = attemptOf(tx);
  const overlay = readOne(storage, id) !== null;
  dropMem(storage, id);
  memFor(storage).push({ tx, overlay });
};
function keysOf(storage: Storage | null): string[] {
  const out: string[] = [];
  try {
    if (!storage) return out;
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k !== null) out.push(k); }
  } catch { /* blocked */ }
  return out;
}
function parse(v: string | null): PendingTx | null {
  if (!v) return null;
  try { const t = JSON.parse(v); return t && typeof t === "object" && typeof t.hash === "string" ? t : null; } catch { return null; }
}
const tombstoned = (storage: Storage | null, id: string) => { try { return storage?.getItem(tombKey(id)) != null; } catch { return false; } };
function readLegacy(storage: Storage | null): PendingTx[] {
  try {
    const v = JSON.parse(storage?.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
/** One attempt's saved entry (its own key, or a not yet migrated legacy entry), unless it settled. */
function readOne(storage: Storage | null, id: string): PendingTx | null {
  if (!storage || tombstoned(storage, id)) return null;
  let own: PendingTx | null = null;
  try { own = parse(storage.getItem(attemptKey(id))); } catch { own = null; }
  return own ?? readLegacy(storage).find((t) => attemptOf(t) === id) ?? null;
}
/** Every saved attempt, oldest first (so `.at(-1)` is the newest). Settled (tombstoned) attempts are never listed. */
export function storedEntries(storage: Storage | null): PendingTx[] {
  if (!storage) return [];
  const byId = new Map<string, PendingTx>();
  for (const t of readLegacy(storage)) byId.set(attemptOf(t), t);
  for (const k of keysOf(storage)) {
    if (!k.startsWith(ATTEMPT_PREFIX)) continue;
    let t: PendingTx | null = null;
    try { t = parse(storage.getItem(k)); } catch { t = null; }
    if (t) byId.set(k.slice(ATTEMPT_PREFIX.length), { ...t, attempt: k.slice(ATTEMPT_PREFIX.length) });
  }
  return [...byId.entries()].filter(([id]) => !tombstoned(storage, id)).map(([, t]) => t).sort((a, b) => a.createdAt - b.createdAt);
}
const readStored = storedEntries;
/** Move entries of the legacy single list to their own keys (idempotent), then drop the list. */
function migrate(storage: Storage | null) {
  if (!storage) return;
  let raw: string | null = null;
  try { raw = storage.getItem(PENDING_KEY); } catch { return; }
  if (raw === null) return;
  try {
    for (const t of readLegacy(storage)) {
      const id = attemptOf(t);
      if (!tombstoned(storage, id) && storage.getItem(attemptKey(id)) === null) storage.setItem(attemptKey(id), JSON.stringify({ ...t, attempt: id }));
    }
    storage.removeItem(PENDING_KEY);
  } catch { /* stays legacy until a write succeeds */ }
}
/** Write one attempt's own key (never another attempt's). A settled attempt is never written back. */
function writeOne(storage: Storage | null, tx: PendingTx): boolean {
  if (!storage) return false;
  const id = attemptOf(tx);
  try {
    migrate(storage);
    if (tombstoned(storage, id)) return true; // settled elsewhere: nothing to keep
    storage.setItem(attemptKey(id), JSON.stringify({ ...tx, attempt: id }));
    // settled while we wrote: withdraw our own write (the settle wrote its tombstone before removing)
    if (tombstoned(storage, id)) storage.removeItem(attemptKey(id));
    return true;
  } catch {
    return false;
  }
}
/** Settle one attempt: tombstone first, then remove its own key (and a legacy copy). Old tombstones are pruned. */
function removeOne(storage: Storage | null, id: string) {
  if (!storage) return;
  try { storage.setItem(tombKey(id), String(Date.now())); } catch { /* quota: removal below still lands */ }
  try { storage.removeItem(attemptKey(id)); } catch { /* blocked */ }
  try {
    const legacy = readLegacy(storage);
    if (legacy.some((t) => attemptOf(t) === id)) migrate(storage);
  } catch { /* ignore */ }
  try {
    const now = Date.now();
    for (const k of keysOf(storage)) if (k.startsWith(TOMB_PREFIX) && now - Number(storage.getItem(k) ?? 0) > TOMB_TTL) storage.removeItem(k);
  } catch { /* ignore */ }
}

/** Pending transaction hashes survive reloads so a closed tab can recover its receipt. */
export const pendingStore = {
  list(storage: Storage | null = safeStorage()): PendingTx[] {
    const stored = readStored(storage);
    const mem = memFor(storage);
    const ids = new Set(stored.map(attemptOf));
    // prune overlays whose attempt storage no longer has: storage is authoritative once it saved
    for (let i = mem.length - 1; i >= 0; i--) if (mem[i].overlay && !ids.has(attemptOf(mem[i].tx))) mem.splice(i, 1);
    const over = new Map(mem.filter((m) => m.overlay).map((m) => [attemptOf(m.tx), m.tx] as const));
    const extra = mem.filter((m) => !m.overlay && !ids.has(attemptOf(m.tx))).map((m) => m.tx);
    return [...stored.map((t) => over.get(attemptOf(t)) ?? t), ...extra];
  },
  /** The saved entry of one attempt, if any. */
  get(attempt: string, storage: Storage | null = safeStorage()): PendingTx | null {
    return this.list(storage).find((t) => attemptOf(t) === attempt) ?? null;
  },
  /** Never throws: saved (replacing this attempt's entry only), or held in memory when the save fails. */
  add(tx: PendingTx, storage: Storage | null = safeStorage()): boolean {
    const id = attemptOf(tx);
    const saved = writeOne(storage, tx);
    if (saved) dropMem(storage, id); else keepMem(storage, tx);
    pendingChanged();
    return saved;
  },
  /** Save an entry to storage or not at all: on failure nothing is kept in memory and false is returned. */
  persist(tx: PendingTx, storage: Storage | null = safeStorage()): boolean {
    const id = attemptOf(tx);
    if (!writeOne(storage, tx)) return false;
    dropMem(storage, id);
    pendingChanged();
    return true;
  },
  /**
   * Save an intent only when no saved entry conflicts with it (e.g. another tab's claim for the same account), then
   * read it back so a write that did not land is never trusted. "saved" | "conflict" | "failed".
   */
  persistExclusive(tx: PendingTx, conflicts: (t: PendingTx) => boolean, storage: Storage | null = safeStorage()): "saved" | "conflict" | "failed" {
    if (!storage) return "failed";
    const id = attemptOf(tx);
    if (this.list(storage).some(conflicts)) return "conflict";
    if (!this.persist(tx, storage)) return "failed";
    const back = readStored(storage);
    if (!back.some((t) => attemptOf(t) === id) && !tombstoned(storage, id)) return "failed";
    if (back.filter(conflicts).some((t) => attemptOf(t) !== id)) {
      this.removeAttempt(id, storage); // lost the race: withdraw only our own intent, never the other one
      return "conflict";
    }
    return "saved";
  },
  /**
   * Replace this attempt's entry (its intent) with the sent transaction in one write. The intent and its sent hash
   * share one attempt id, so no other attempt's entry is touched. Never throws: if the write fails the intent stays
   * saved and this page holds the sent hash in memory. Returns whether the sent entry itself was saved.
   */
  replace(attempt: string, tx: PendingTx, storage: Storage | null = safeStorage()): boolean {
    const next = { ...tx, attempt };
    const saved = writeOne(storage, next);
    if (saved) dropMem(storage, attempt); else keepMem(storage, next);
    pendingChanged();
    return saved;
  },
  /**
   * Compare-and-update: change this attempt's entry only while it is still saved (and, when given, still has the
   * expected hash). A settled or released attempt is never resurrected. "updated" | "missing" | "failed".
   */
  update(attempt: string, f: (cur: PendingTx) => PendingTx, storage: Storage | null = safeStorage(), expectHash?: string): "updated" | "missing" | "failed" {
    const inMem = memFor(storage).find((m) => attemptOf(m.tx) === attempt)?.tx;
    const matches = (t: PendingTx) => expectHash === undefined || t.hash.toLowerCase() === expectHash.toLowerCase();
    const cur = readOne(storage, attempt);
    if (cur && matches(cur)) {
      const next = { ...f(cur), attempt };
      if (!writeOne(storage, next)) return "failed";
      if (readOne(storage, attempt) === null) return "missing"; // settled meanwhile: our write was withdrawn
      pendingChanged();
      return "updated";
    }
    if (!cur && inMem && matches(inMem) && !tombstoned(storage, attempt)) {
      keepMem(storage, { ...f(inMem), attempt });
      pendingChanged();
      return "updated";
    }
    return "missing";
  },
  /** Remove exactly one attempt (saved copy and memory fallback). Other attempts, even with the same placeholder hash, stay. */
  removeAttempt(attempt: string, storage: Storage | null = safeStorage()) {
    dropMem(storage, attempt);
    removeOne(storage, attempt);
    pendingChanged();
  },
  /** Remove entries by transaction hash. Placeholder intent hashes are shared, so intents are never removed this way. */
  remove(hash: string, storage: Storage | null = safeStorage()) {
    const hit = (t: PendingTx) => t.hash.toLowerCase() === hash.toLowerCase() && !t.intent;
    const m = memFor(storage);
    for (let i = m.length - 1; i >= 0; i--) if (hit(m[i].tx)) m.splice(i, 1);
    for (const t of readStored(storage)) if (hit(t)) removeOne(storage, attemptOf(t));
    pendingChanged();
  },
  /** Can recovery data be saved right now? Checked before the wallet is asked to sign a purchase. */
  writable(storage: Storage | null = safeStorage()): boolean {
    if (!storage) return false;
    try {
      const k = `${PENDING_KEY}:probe`;
      storage.setItem(k, "1");
      storage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  },
  /** For useSyncExternalStore: the list changes whenever a hash is added or removed. */
  subscribe(f: () => void) {
    pendingSubs.add(f);
    return () => { pendingSubs.delete(f); };
  },
  version: () => pendingVersion,
};

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Latest verified allowance: whichever read is newer wins (the wallet query or the read taken right after a confirmed
 * approval). Never the larger of the two: after a revocation or reduction the newer, smaller value is shown and a
 * fresh exact approval is requested.
 */
export function latestAllowance(read?: { allowance: bigint; at: number } | null, approval?: { allowance: bigint; at: number } | null): bigint | undefined {
  if (read && approval) return approval.at > read.at ? approval.allowance : read.allowance;
  return read?.allowance ?? approval?.allowance;
}

/** The wallet's live account, chain and connector, read from the connector itself just before a request is sent. */
export interface WalletState { account?: string; chainId?: number; connector?: string }
/**
 * What the initiating click was bound to: the connector and a wallet-state revision (incremented on every observed
 * account, chain or connector change). Any change after the click invalidates the preparation, even when the wallet
 * was switched back to the original account and chain before the request: a fresh click is required.
 */
export interface WalletBinding { revision?: () => number; connector?: string }
export const WALLET_CHANGED_MESSAGE =
  "Your wallet's account or network changed while this was being prepared. Nothing was sent from the new account; check the details and press the button again.";
/** True only when the wallet is still on the initiating account and on Ethereum. */
export async function walletStillBound(account: string, read?: () => Promise<WalletState>, fallbackChain?: () => number, binding?: WalletBinding & { at?: number }): Promise<boolean> {
  const unchanged = () => !binding?.revision || binding.at === undefined || binding.revision() === binding.at;
  if (!unchanged()) return false;
  if (!read) return fallbackChain ? fallbackChain() === 1 : false;
  let w: WalletState | null = null;
  try { w = await read(); } catch { w = null; }
  if (!w || !w.account || !sameAddr(w.account, account) || w.chainId !== 1) return false;
  if (binding?.connector && w.connector && w.connector !== binding.connector) return false;
  return unchanged();
}

export type Step =
  | { name: "checking" }
  | { name: "approve-wallet"; amount: bigint }
  | { name: "approve-pending"; hash: Hash }
  /** The approval may have been sent (no hash, or no readable receipt): its record stays saved and the form locked. */
  | { name: "approve-unknown"; hash: Hash; message: string }
  | { name: "simulating" }
  | { name: "buy-wallet" }
  | { name: "buy-pending"; hash: Hash }
  /** The purchase was sent but its receipt could not be read: it stays pending and the draft stays locked. */
  | { name: "buy-unknown"; hash: Hash; message: string }
  | { name: "done"; hash: Hash; firstId: number | null; quantity?: number }
  /** hash: a mined transaction the message refers to (a different confirmed purchase), linked in the UI. */
  | { name: "error"; message: string; hash?: Hash; approval?: ApprovalDone; allowance?: { allowance: bigint; at: number } };

/** An approval that confirmed in this attempt: its receipt and the allowance read afterwards. */
export interface ApprovalDone { hash: Hash; allowance: bigint; at: number }
export const APPROVED_NOT_SENT = "Approval confirmed; candle purchase not sent.";
/** After a confirmed approval no message may say "Nothing was sent". */
export const afterApproval = (m: string) => m.replace(/Nothing was sent/g, "The candle purchase was not sent");

/** The garden CandlesPurchased event found in a receipt, read from the garden contract's own logs only. */
export interface PurchaseEvent { purchaser: string; firstId: number; quantity: number }
export interface Receipt {
  status: "success" | "reverted";
  /** Hash of the mined transaction: differs from the sent hash when the wallet sped up or replaced it. */
  hash?: Hash;
  purchase?: PurchaseEvent | null;
  /** CandleCreated events emitted by the garden in this receipt. */
  created?: { id: number; purchaser: string; style: number; wish: string }[];
  /** The mined transaction: sender, target and decoded buyCandles calldata (null when it is not buyCandles). */
  from?: string;
  to?: string | null;
  call?: { styles: number[]; wishes: string[] } | null;
}
export interface Draft { styles: number[]; wishes: string[] }

const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export const REPLACED_MESSAGE =
  "This purchase was cancelled or replaced in your wallet, so no candles were lit and no IMD was taken for them. Your wish is kept; you can light it again.";

export const UNVERIFIED_MESSAGE =
  "The purchase has a receipt, but its transaction could not be read to check the exact styles and wishes. It stays saved and this draft stays locked; check again in a moment.";

/** A successful replacement that bought candles other than this draft: funds moved, the draft is not completed. */
export function differentPurchaseMessage(created: { id: number }[]): string {
  const ids = created.map((c) => `#${c.id}`).join(", ");
  return `Your replacement transaction confirmed a different candle purchase${ids ? ` (candles ${ids})` : ""}. This draft was not completed. Review the confirmed transaction before buying again.`;
}

/**
 * A purchase is complete only when its mined receipt succeeded, the mined transaction itself was read (sender,
 * target and calldata), it is this account calling buyCandles on the garden with exactly the signed styles and
 * wishes, and the garden's CandlesPurchased and CandleCreated events match that draft in order. The mined hash
 * (a sped-up replacement's, if any) is the one linked.
 *  - no purchase event for this account: cancelled/replaced, nothing bought (error, draft kept)
 *  - the transaction or its events could not be read: buy-unknown (pending entry and draft kept, retryable)
 *  - a successful purchase that differs from the draft: a different confirmed purchase (error with its hash)
 */
export function settleBuy(r: Receipt, sent: Hash, account: string, quantity?: number, draft?: Draft, garden: string = GARDEN): Step {
  if (r.status !== "success") return { name: "error", message: "The purchase reverted onchain. Your IMD was not taken; only gas was spent." };
  const me = account.toLowerCase();
  const ev = r.purchase;
  if (r.purchase === undefined) return { name: "buy-unknown", hash: sent, message: UNVERIFIED_MESSAGE };
  if (!ev || ev.purchaser.toLowerCase() !== me) return { name: "error", message: REPLACED_MESSAGE };
  // the garden bought candles for this account in this transaction: settle only with its calldata and events in hand
  if (r.created === undefined || r.from === undefined || r.call === undefined || r.to === undefined) return { name: "buy-unknown", hash: sent, message: UNVERIFIED_MESSAGE };
  const mined = r.hash ?? sent;
  const different: Step = { name: "error", hash: mined, message: differentPurchaseMessage([...r.created].sort((a, b) => a.id - b.id)) };
  if (r.from.toLowerCase() !== me || r.to?.toLowerCase() !== garden.toLowerCase() || !r.call) return different;
  const want = draft;
  const q = draft ? draft.styles.length : quantity;
  if (q !== undefined && (ev.quantity !== q || r.call.styles.length !== q)) return different;
  if (want) {
    if (!same(r.call.styles, want.styles) || !same(r.call.wishes, want.wishes)) return different;
    const c = [...r.created].sort((a, b) => a.id - b.id);
    const ok = c.length === want.styles.length && c.every((x, i) => x.id === ev.firstId + i && x.purchaser.toLowerCase() === me && x.style === want.styles[i] && x.wish === want.wishes[i]);
    if (!ok) return different;
  }
  return { name: "done", hash: mined, firstId: ev.firstId, quantity: ev.quantity };
}

/**
 * One shared purchase state, so a remounted form or a reload sees a purchase that is still in flight. The step belongs
 * to the account that started it: another connected account never sees (or is blocked by) it, and switching back
 * restores it. The durable intent in pendingStore is scoped the same way.
 */
let flowStep: Step | null = null;
let flowAccount: string | null = null;
let flowAttempt: string | null = null;
const flowSubs = new Set<() => void>();
const notifyFlow = () => flowSubs.forEach((f) => f());
export const purchaseFlow = {
  get: () => flowStep,
  /** The account the current step belongs to (null for a step recorded without one). */
  account: () => flowAccount,
  /** The attempt the current step belongs to. */
  attempt: () => flowAttempt,
  /** The current step if it belongs to this account (or to no particular account), otherwise null. */
  for(account: string | null | undefined): Step | null {
    if (flowAccount === null) return flowStep;
    return account && sameAddr(account, flowAccount) ? flowStep : null;
  },
  set(s: Step | null, account: string | null = null, attempt: string | null = null) {
    flowStep = s;
    flowAccount = s === null ? null : account;
    flowAttempt = s === null ? null : attempt;
    notifyFlow();
  },
  /**
   * A step reported by one attempt: applied only when the shown step is this attempt's, or no other attempt is
   * running or uncertain. A delayed receipt or callback of an older attempt never overwrites a newer attempt.
   */
  report(attempt: string, s: Step, account: string): boolean {
    if (flowAttempt !== null && flowAttempt !== attempt && isRunning(flowStep)) return false;
    this.set(s, account, attempt);
    return true;
  },
  /** Drop the step of this account only (a released intent); another account's step is left alone. */
  clear(account: string, attempt?: string) {
    if (flowAccount !== null && !sameAddr(flowAccount, account)) return;
    if (attempt !== undefined && flowAttempt !== null && flowAttempt !== attempt) return;
    flowStep = null;
    flowAccount = null;
    flowAttempt = null;
    notifyFlow();
  },
  subscribe(f: () => void) {
    flowSubs.add(f);
    return () => { flowSubs.delete(f); };
  },
};
// another tab settled or matched this tab's uncertain attempt: release only that attempt's UI lock
pendingStore.subscribe(() => {
  if (flowAttempt && (flowStep?.name === "buy-unknown" || flowStep?.name === "approve-unknown") && !pendingStore.get(flowAttempt)) purchaseFlow.clear(flowAccount ?? "", flowAttempt);
});
export const isRunning = (s: Step | null) => s !== null && s.name !== "done" && s.name !== "error";

/** Everything the purchase needs from a chain. The UI passes wagmi/viem; tests pass labelled mocks. */
export interface PurchaseDeps {
  account: string;
  chainId: () => number;
  salesOpen: () => Promise<boolean>;
  balance: () => Promise<bigint>;
  allowance: () => Promise<bigint>;
  ethBalance: () => Promise<bigint>;
  approve: (amount: bigint) => Promise<Hash>;
  /** Resolves with the mined receipt (following replacements, or recovering them from the saved sender and nonce). */
  wait: (hash: Hash, tx?: PendingTx) => Promise<Receipt>;
  /** Records candle id -> mined transaction hash for the explorer links. */
  remember?: (firstId: number, quantity: number, hash: Hash) => void;
  simulate: (styles: number[], wishes: string[]) => Promise<unknown>;
  buy: (request: unknown) => Promise<Hash>;
  /** Sender nonce and current block read just before the purchase is requested (for bounded recovery). Required. */
  submission: () => Promise<{ nonce: number; block: bigint }>;
  /** The submitted transaction by its hash (sender and actual nonce), or null while the node does not know it yet. */
  sentTx?: (hash: Hash) => Promise<{ from: string; nonce: number } | null>;
  /** Fixture pages are read-only: no approval or purchase request ever reaches the wallet. */
  readOnly?: boolean;
  explain: (e: unknown) => string;
  storage?: Storage | null;
  /** Cross-tab mutual exclusion for saving the intent (Web Locks in the app); "busy" when another tab holds it. */
  withLock?: <T>(name: string, f: () => Promise<T> | T) => Promise<T | "busy">;
  /**
   * The wallet's live account and chain, re-read from the connector immediately before each wallet request (approve
   * and buy). A different account or chain ends the attempt with nothing sent; a fresh click is required.
   */
  walletState?: () => Promise<WalletState>;
  /** Attempt id factory (tests pass a fixed sequence). */
  newAttempt?: () => string;
  /** The initiating click's wallet binding: revision counter and connector (see WalletBinding). */
  binding?: WalletBinding;
  /**
   * What the quote shown at the click said: false when it said the allowance already covered the purchase. If the live
   * allowance then turns out lower, nothing is sent: the new allowance is shown and a fresh Approve click is required.
   */
  expectApproval?: boolean;
}

/**
 * Exact-approval purchase: read balance and allowance, approve exactly the shortfall total if needed,
 * wait for its receipt, simulate buyCandles(styles, wishes), then ask for the purchase. Candles are
 * shown only after the purchase receipt reports success.
 */
export async function runPurchase(
  deps: PurchaseDeps,
  styles: number[],
  wishes: string[],
  onStep: (s: Step, attempt: string) => void,
): Promise<Step> {
  const attempt = (deps.newAttempt ?? newAttemptId)();
  const step = (s: Step) => onStep(s, attempt);
  let approval: ApprovalDone | undefined;
  const fail = (message: string): Step => {
    const s: Step = approval ? { name: "error", message: afterApproval(message), approval } : { name: "error", message };
    step(s);
    return s;
  };
  if (deps.readOnly) return fail(FIXTURE_MESSAGE);
  const binding = { ...deps.binding, at: deps.binding?.revision?.() };
  const bound = () => walletStillBound(deps.account, deps.walletState, deps.chainId, binding);
  let sent: PendingTx | null = null;
  try {
    if (styles.length < 1 || styles.length > 50 || styles.length !== wishes.length) return fail("Choose between 1 and 50 candles.");
    if (deps.chainId() !== 1) return fail("Your wallet is on another network. Switch to Ethereum to continue.");
    // a saved purchase or purchase intent (this tab, another tab, or before a reload/reconnect) blocks a second one
    const conflict = buyConflict(deps.account);
    const store = deps.storage === undefined ? undefined : deps.storage;
    if (pendingStore.list(store).some(conflict)) return fail(DUPLICATE_MESSAGE);
    step({ name: "checking" });
    if (!(await deps.salesOpen())) return fail("Sales are closed: the garden is not activated or purchases are paused.");
    const total = BigInt(styles.length) * 10n ** 18n;
    const [bal, allow, ethBal] = await Promise.all([deps.balance(), deps.allowance(), deps.ethBalance()]);
    if (bal < total) return fail(`You need ${styles.length} IMD; your wallet holds less. Add IMD on Ethereum and try again.`);
    if (ethBal === 0n) return fail("Your wallet has no ETH to pay gas on Ethereum.");
    if (allow < total) {
      if (deps.expectApproval === false) {
        // the quote said "already covered" but the live allowance is lower (revoked or reduced): no wallet request from
        // this purchase-only click. The new allowance is shown and a fresh, explicit approval click is required.
        const s: Step = { name: "error", message: allowanceChangedMessage(allow, styles.length), allowance: { allowance: allow, at: Date.now() } };
        step(s);
        return s;
      }
      // a durable approval intent is saved BEFORE the wallet is asked: account, Ethereum, token, spender, exact amount,
      // preflight nonce and block, under its own attempt id. A wallet that fails without a hash leaves it saved and the
      // form locked with receipt/hash recovery, so a second approval is never requested on top of one that may be sent.
      let asub: { nonce: number; block: bigint };
      try { asub = await deps.submission(); } catch { return fail(META_MESSAGE); }
      const approveAttempt = (deps.newAttempt ?? newAttemptId)();
      const aIntent: PendingTx = {
        hash: intentHash("approve", deps.account), kind: "approve", intent: true, account: deps.account, quantity: styles.length,
        createdAt: Date.now(), from: deps.account, nonce: asub.nonce, block: asub.block.toString(), nonceChecked: false,
        chainId: 1, token: IMD, spender: GARDEN, amount: total.toString(), attempt: approveAttempt,
      };
      const aw = () => pendingStore.persistExclusive(aIntent, conflict, store);
      const aSaved = deps.withLock ? await deps.withLock(`everlight-buy-${deps.account.toLowerCase()}`, aw) : aw();
      if (aSaved === "busy" || aSaved === "conflict") return fail(DUPLICATE_MESSAGE);
      if (aSaved !== "saved") return fail(STORAGE_MESSAGE);
      // the approval is bound to the initiating account, connector and Ethereum: re-read the wallet after the async checks
      if (!(await bound())) {
        pendingStore.removeAttempt(approveAttempt, deps.storage);
        return fail(WALLET_CHANGED_MESSAGE);
      }
      step({ name: "approve-wallet", amount: total });
      let ah: Hash;
      try {
        ah = await deps.approve(total);
      } catch (e) {
        if (isProvenRejection(e)) {
          pendingStore.removeAttempt(approveAttempt, deps.storage); // proven: nothing was signed; only this attempt
          throw e;
        }
        const s: Step = { name: "approve-unknown", hash: aIntent.hash, message: APPROVAL_AMBIGUOUS_MESSAGE };
        step(s);
        return s;
      }
      const aSent: PendingTx = { ...aIntent, hash: ah, intent: undefined };
      pendingStore.replace(approveAttempt, aSent, deps.storage);
      step({ name: "approve-pending", hash: ah });
      let r: Receipt;
      try {
        r = await deps.wait(ah, aSent);
      } catch {
        const s: Step = { name: "approve-unknown", hash: ah, message: APPROVAL_SENT_UNKNOWN_MESSAGE };
        step(s);
        return s;
      }
      pendingStore.removeAttempt(approveAttempt, deps.storage); // only this approval's own entry
      if (r.status !== "success") return fail("The approval transaction reverted. No IMD was spent.");
      const now = await deps.allowance();
      if (now < total) return fail("The approval did not reach the required total. Approve again.");
      // tracked separately from the purchase: a later failure says the approval stands and the purchase was not sent
      // the receipt's own hash: a sped-up approval is mined under its replacement's hash, and that is the receipt linked
      approval = { hash: r.hash ?? ah, allowance: now, at: Date.now() };
    }
    step({ name: "simulating" });
    const request = await deps.simulate(styles, wishes);
    // recovery metadata comes first: without the sender's nonce and a submission block a replacement could not be
    // found after a reload, so the wallet is not asked to sign until both are read
    let sub: { nonce: number; block: bigint };
    try {
      sub = await deps.submission();
    } catch {
      return fail(META_MESSAGE);
    }
    // the purchase must be recoverable after a reload, so its recovery intent (exact draft, sender, preflight nonce and
    // submission block, under this attempt's id) is saved before the wallet is asked to sign; if it cannot be saved,
    // nothing is sent
    const ih = buyIntentHash(deps.account);
    const intent: PendingTx = {
      hash: ih, kind: "buy", intent: true, account: deps.account, quantity: styles.length, createdAt: Date.now(),
      from: deps.account, nonce: sub.nonce, block: sub.block.toString(), nonceChecked: false, styles: [...styles], wishes: [...wishes], attempt,
    };
    // saved exclusively (under a per-account Web Lock, then read back): two tabs that both passed the first check
    // cannot both reach the wallet, and neither overwrites the other's intent
    const write = () => pendingStore.persistExclusive(intent, conflict, store);
    const saved0 = deps.withLock ? await deps.withLock(`everlight-buy-${deps.account.toLowerCase()}`, write) : write();
    if (saved0 === "busy" || saved0 === "conflict") return fail(DUPLICATE_MESSAGE);
    if (saved0 !== "saved") return fail(STORAGE_MESSAGE);
    // last check before the signature request: still the initiating account, still Ethereum. Otherwise nothing is
    // sent, this attempt's own intent is withdrawn and a fresh click is required
    if (!(await bound())) {
      pendingStore.removeAttempt(attempt, deps.storage);
      return fail(WALLET_CHANGED_MESSAGE);
    }
    step({ name: "buy-wallet" });
    let hash: Hash;
    try {
      hash = await deps.buy(request);
    } catch (e) {
      if (isProvenRejection(e)) {
        pendingStore.removeAttempt(attempt, deps.storage); // proven: the wallet refused before signing; only this attempt
        throw e;
      }
      // a disconnect (4900/4901), a timeout or an unknown failure: the wallet may have broadcast the purchase (even at
      // a higher or private nonce) and lost its hash. The intent stays saved and the draft stays locked until the
      // purchase is found, or its hash is pasted and validated. An unrelated transaction at the preflight nonce is
      // never taken as proof of cancellation.
      const s: Step = { name: "buy-unknown", hash: ih, message: AMBIGUOUS_MESSAGE };
      step(s);
      return s;
    }
    // from here on the purchase is broadcast: no failure may unlock the draft as if nothing had been sent
    sent = {
      hash, kind: "buy", account: deps.account, quantity: styles.length, createdAt: Date.now(),
      from: deps.account, nonce: sub.nonce, block: sub.block.toString(), nonceChecked: false, styles: [...styles], wishes: [...wishes], attempt,
    };
    const saved = pendingStore.replace(attempt, sent, deps.storage);
    step({ name: "buy-pending", hash });
    const checked = saved ? await reconcileSent(deps, sent) : await reconcileSent(deps, sent).catch(() => sent!);
    return await awaitBuy(deps, checked, step);
  } catch (e) {
    if (sent) {
      // a failure after broadcast (storage, RPC): keep this attempt pending and the draft locked, never a plain error
      if (pendingStore.update(attempt, (t) => (t.intent ? sent! : t), deps.storage) === "missing") pendingStore.add(sent, deps.storage);
      const s: Step = { name: "buy-unknown", hash: sent.hash, message: SENT_UNKNOWN_MESSAGE };
      step(s);
      return s;
    }
    return fail(deps.explain(e));
  }
}


export const DUPLICATE_MESSAGE =
  "An earlier purchase is still saved as pending or possibly sent, so another one is not requested. Check it below first.";
export const AMBIGUOUS_MESSAGE =
  "Your wallet stopped answering before it returned a transaction hash, so this purchase may have been sent. It stays saved and this draft stays locked so it is not bought twice. Check again, or paste the transaction hash from your wallet's activity.";
export const STORAGE_MESSAGE =
  "This browser is not letting the site save recovery data (storage is full or blocked), so a sent purchase could not be recovered after a reload. Nothing was sent and your draft is kept. Free some site storage or leave private mode, then try again.";
export const SENT_UNKNOWN_MESSAGE =
  "Your purchase may have been sent, but the page could not finish tracking it. It stays locked on this transaction so it is not sent twice; check its receipt below.";

export const INTENT_PENDING_MESSAGE =
  "This transaction may have been sent. Check again, or paste the transaction hash from your wallet's activity. The action stays locked until the transaction can be verified.";
export const APPROVAL_AMBIGUOUS_MESSAGE =
  "Your wallet stopped answering before it returned a transaction hash, so this approval may have been sent. It stays saved and the form stays locked so a second approval is not requested. Check again, or paste the transaction hash from your wallet's activity.";
export const APPROVAL_SENT_UNKNOWN_MESSAGE =
  "Your approval may have been sent, but its receipt could not be read yet. It stays saved and the form stays locked so a second approval is not requested; check again in a moment.";
export function allowanceChangedMessage(allowance: bigint, n: number): string {
  return `Your IMD allowance changed after the quote: it is now ${imd(allowance)} IMD, which does not cover ${n} IMD. Nothing was sent. Press "Approve exactly ${n} IMD" to request a fresh approval.`;
}

export const FIXTURE_MESSAGE = "Test fixture: simulated candles, transactions disabled. Open the garden without ?fixture to light real candles.";
export const META_MESSAGE =
  "Your account's nonce and the current block could not be read, so this purchase could not be recovered after a reload. Nothing was sent and your draft is kept; try again.";

/**
 * Replace the preflight sender/nonce of a saved transaction with the submitted transaction's own (read by its hash),
 * so the bounded replacement search after a reload looks for the nonce the wallet actually used. A failed read keeps
 * the preflight values with nonceChecked false; recovery retries the reconciliation.
 */
export async function reconcileSent(
  deps: Pick<PurchaseDeps, "sentTx" | "storage">,
  tx: PendingTx,
  tries = 3,
  pause = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<PendingTx> {
  if (!deps.sentTx || tx.nonceChecked) return tx;
  for (let i = 0; i < tries; i++) {
    const got = await deps.sentTx(tx.hash).catch(() => null);
    if (got) {
      const next: PendingTx = { ...tx, from: got.from, nonce: got.nonce, nonceChecked: true };
      // compare-and-update: only while this attempt is still saved under this hash (never resurrect a settled one)
      pendingStore.update(attemptOf(tx), () => next, deps.storage, tx.hash);
      return next;
    }
    if (i < tries - 1) await pause(1500);
  }
  return tx;
}

/**
 * Wait for a sent purchase (now or after a reload) and settle it from its mined receipt. If the receipt
 * cannot be read the hash stays pending and the step is buy-unknown, so the same draft is not sent twice.
 */
export async function awaitBuy(
  deps: Pick<PurchaseDeps, "wait" | "remember" | "explain" | "storage">,
  tx: PendingTx,
  onStep: (s: Step) => void,
): Promise<Step> {
  let r: Receipt;
  try {
    r = await deps.wait(tx.hash, tx);
  } catch (e) {
    const s: Step = { name: "buy-unknown", hash: tx.hash, message: deps.explain(e) };
    onStep(s);
    return s;
  }
  const draft = tx.styles && tx.wishes && tx.styles.length === tx.wishes.length ? { styles: tx.styles, wishes: tx.wishes } : undefined;
  const s = settleBuy(r, tx.hash, tx.account, tx.quantity, draft);
  // an unverified receipt keeps the attempt saved (and the draft locked) so verification can be retried; a settled
  // receipt removes exactly this attempt, never a newer one saved by another tab under the same placeholder
  if (s.name !== "buy-unknown") pendingStore.removeAttempt(attemptOf(tx), deps.storage);
  if (s.name === "done" && r.purchase) deps.remember?.(r.purchase.firstId, r.purchase.quantity, s.hash);
  onStep(s);
  return s;
}
