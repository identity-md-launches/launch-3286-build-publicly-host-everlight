import type { Hash } from "viem";
import { GARDEN } from "../config";
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
}

/**
 * Legacy placeholder hash of a recovery intent saved by earlier builds under one key for every account. New intents
 * are saved per account under intentHash("buy", account); a legacy entry is still honoured (and released) only for
 * the account that wrote it.
 */
export const INTENT_HASH = `0x${"0".repeat(64)}` as Hash;

const sameAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** A saved purchase or purchase intent of this account: the duplicate guard and the exclusive save match exactly these. */
export const buyConflict = (account: string) => (t: PendingTx) => t.kind === "buy" && sameAddr(t.account, account);
/** The placeholder hash this account's purchase intent is saved under. */
export const buyIntentHash = (account: string) => intentHash("buy", account);
/** Remove this account's purchase intent (and a legacy shared intent only when this account wrote it). */
export function removeBuyIntent(account: string, storage: Storage | null = safeStorage()) {
  pendingStore.remove(buyIntentHash(account), storage);
  if (pendingStore.list(storage).some((t) => t.hash === INTENT_HASH && sameAddr(t.account, account))) pendingStore.remove(INTENT_HASH, storage);
}

// v2: scoped to the live garden, so a transaction sent to an earlier contract is never re-attached here
const PENDING_KEY = "everlight:v2:pending:0x33a514c5e2028f1affd70b82f170e8193df030a5";
const pendingSubs = new Set<() => void>();
let pendingVersion = 0;
const pendingChanged = () => { pendingVersion++; pendingSubs.forEach((f) => f()); };
// another tab saving or settling a transaction updates this tab's locks at once (claims, purchases, intents)
try {
  if (typeof window !== "undefined") window.addEventListener("storage", (e) => { if (e.key === null || e.key === PENDING_KEY) pendingChanged(); });
} catch { /* no window */ }
export const PENDING_STORAGE_KEY = PENDING_KEY;

/**
 * In-memory copy of every pending entry, per storage object. A hash is kept here the moment it is known, so even if
 * the browser refuses to save it (quota, blocked storage) the page stays locked on it until its receipt settles.
 */
const memory = new WeakMap<object, PendingTx[]>();
const NO_STORAGE = {};
const memFor = (storage: Storage | null) => {
  const k = storage ?? NO_STORAGE;
  let l = memory.get(k);
  if (!l) memory.set(k, (l = []));
  return l;
};
function readStored(storage: Storage | null): PendingTx[] {
  try {
    const v = JSON.parse(storage?.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Pending transaction hashes survive reloads so a closed tab can recover its receipt. */
export const pendingStore = {
  list(storage: Storage | null = safeStorage()): PendingTx[] {
    const stored = readStored(storage);
    const extra = memFor(storage).filter((m) => !stored.some((t) => t.hash === m.hash));
    return [...stored, ...extra];
  },
  /** Never throws: the entry is held in memory first, then saved; returns false when it could not be saved. */
  add(tx: PendingTx, storage: Storage | null = safeStorage()): boolean {
    const mem = memFor(storage);
    const i = mem.findIndex((t) => t.hash === tx.hash);
    if (i >= 0) mem[i] = tx; else mem.push(tx);
    let saved = false;
    try {
      if (storage) {
        storage.setItem(PENDING_KEY, JSON.stringify([...readStored(storage).filter((t) => t.hash !== tx.hash), tx]));
        saved = true;
      }
    } catch { /* kept in memory: this page stays locked on it, but a reload cannot recover it */ }
    pendingChanged();
    return saved;
  },
  /**
   * Save an entry to storage or not at all: on failure nothing is kept in memory and false is returned. Used for the
   * recovery intent, which must be in storage before the wallet is asked to sign.
   */
  persist(tx: PendingTx, storage: Storage | null = safeStorage()): boolean {
    if (!storage) return false;
    try {
      storage.setItem(PENDING_KEY, JSON.stringify([...readStored(storage).filter((t) => t.hash !== tx.hash), tx]));
    } catch {
      return false;
    }
    const mem = memFor(storage);
    const i = mem.findIndex((t) => t.hash === tx.hash);
    if (i >= 0) mem[i] = tx; else mem.push(tx);
    pendingChanged();
    return true;
  },
  /**
   * Save an intent only when no saved entry conflicts with it (e.g. another tab's claim for the same account), then
   * read it back so a write that did not land is never trusted. "saved" | "conflict" | "failed".
   */
  persistExclusive(tx: PendingTx, conflicts: (t: PendingTx) => boolean, storage: Storage | null = safeStorage()): "saved" | "conflict" | "failed" {
    if (!storage) return "failed";
    if (readStored(storage).some(conflicts) || memFor(storage).some(conflicts)) return "conflict";
    if (!this.persist(tx, storage)) return "failed";
    const back = readStored(storage);
    if (!back.some((t) => t.hash === tx.hash)) return "failed";
    if (back.filter(conflicts).some((t) => t.hash !== tx.hash)) return "conflict";
    return "saved";
  },
  /**
   * Replace a saved entry (the recovery intent) with the sent transaction in one write. Never throws: if the write
   * fails the intent stays saved, so a reload still locks the form and resolves the purchase by its nonce, and this
   * page holds the sent hash in memory. Returns whether the sent entry itself was saved.
   */
  replace(oldHash: string, tx: PendingTx, storage: Storage | null = safeStorage()): boolean {
    const mem = memFor(storage);
    const j = mem.findIndex((t) => t.hash === oldHash);
    if (j >= 0) mem.splice(j, 1);
    const i = mem.findIndex((t) => t.hash === tx.hash);
    if (i >= 0) mem[i] = tx; else mem.push(tx);
    let saved = false;
    try {
      if (storage) {
        storage.setItem(PENDING_KEY, JSON.stringify([...readStored(storage).filter((t) => t.hash !== tx.hash && t.hash !== oldHash), tx]));
        saved = true;
      }
    } catch { /* the intent stays saved */ }
    pendingChanged();
    return saved;
  },
  remove(hash: string, storage: Storage | null = safeStorage()) {
    const mem = memFor(storage);
    const i = mem.findIndex((t) => t.hash === hash);
    if (i >= 0) mem.splice(i, 1);
    try {
      const rest = readStored(storage).filter((t) => t.hash !== hash);
      if (rest.length) storage?.setItem(PENDING_KEY, JSON.stringify(rest));
      else storage?.removeItem(PENDING_KEY);
    } catch { /* nothing more to do */ }
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

export type Step =
  | { name: "checking" }
  | { name: "approve-wallet"; amount: bigint }
  | { name: "approve-pending"; hash: Hash }
  | { name: "simulating" }
  | { name: "buy-wallet" }
  | { name: "buy-pending"; hash: Hash }
  /** The purchase was sent but its receipt could not be read: it stays pending and the draft stays locked. */
  | { name: "buy-unknown"; hash: Hash; message: string }
  | { name: "done"; hash: Hash; firstId: number | null; quantity?: number }
  /** hash: a mined transaction the message refers to (a different confirmed purchase), linked in the UI. */
  | { name: "error"; message: string; hash?: Hash; approval?: ApprovalDone };

/** An approval that confirmed in this attempt: its receipt and the allowance read afterwards. */
export interface ApprovalDone { hash: Hash; allowance: bigint }
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

/** One shared purchase state, so a remounted form or a reload sees a purchase that is still in flight. */
let flowStep: Step | null = null;
const flowSubs = new Set<() => void>();
export const purchaseFlow = {
  get: () => flowStep,
  set(s: Step | null) {
    flowStep = s;
    flowSubs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    flowSubs.add(f);
    return () => { flowSubs.delete(f); };
  },
};
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
  onStep: (s: Step) => void,
): Promise<Step> {
  let approval: ApprovalDone | undefined;
  const fail = (message: string): Step => {
    const s: Step = approval ? { name: "error", message: afterApproval(message), approval } : { name: "error", message };
    onStep(s);
    return s;
  };
  if (deps.readOnly) return fail(FIXTURE_MESSAGE);
  let sent: PendingTx | null = null;
  try {
    if (styles.length < 1 || styles.length > 50 || styles.length !== wishes.length) return fail("Choose between 1 and 50 candles.");
    if (deps.chainId() !== 1) return fail("Your wallet is on another network. Switch to Ethereum to continue.");
    // a saved purchase or purchase intent (this tab, another tab, or before a reload/reconnect) blocks a second one
    const conflict = buyConflict(deps.account);
    const store = deps.storage === undefined ? undefined : deps.storage;
    if (pendingStore.list(store).some(conflict)) return fail(DUPLICATE_MESSAGE);
    onStep({ name: "checking" });
    if (!(await deps.salesOpen())) return fail("Sales are closed: the garden is not activated or purchases are paused.");
    const total = BigInt(styles.length) * 10n ** 18n;
    const [bal, allow, ethBal] = await Promise.all([deps.balance(), deps.allowance(), deps.ethBalance()]);
    if (bal < total) return fail(`You need ${styles.length} IMD; your wallet holds less. Add IMD on Ethereum and try again.`);
    if (ethBal === 0n) return fail("Your wallet has no ETH to pay gas on Ethereum.");
    if (allow < total) {
      onStep({ name: "approve-wallet", amount: total });
      const ah = await deps.approve(total);
      pendingStore.add({ hash: ah, kind: "approve", account: deps.account, createdAt: Date.now() }, deps.storage);
      onStep({ name: "approve-pending", hash: ah });
      const r = await deps.wait(ah);
      pendingStore.remove(ah, deps.storage);
      if (r.status !== "success") return fail("The approval transaction reverted. No IMD was spent.");
      const now = await deps.allowance();
      if (now < total) return fail("The approval did not reach the required total. Approve again.");
      // tracked separately from the purchase: a later failure says the approval stands and the purchase was not sent
      approval = { hash: ah, allowance: now };
    }
    onStep({ name: "simulating" });
    const request = await deps.simulate(styles, wishes);
    // recovery metadata comes first: without the sender's nonce and a submission block a replacement could not be
    // found after a reload, so the wallet is not asked to sign until both are read
    let sub: { nonce: number; block: bigint };
    try {
      sub = await deps.submission();
    } catch {
      return fail(META_MESSAGE);
    }
    // the purchase must be recoverable after a reload, so its recovery intent (exact draft, sender, nonce and
    // submission block, with room for the hash) is saved before the wallet is asked to sign; if it cannot be saved,
    // nothing is sent
    const ih = buyIntentHash(deps.account);
    const intent: PendingTx = {
      hash: ih, kind: "buy", intent: true, account: deps.account, quantity: styles.length, createdAt: Date.now(),
      from: deps.account, nonce: sub.nonce, block: sub.block.toString(), nonceChecked: false, styles: [...styles], wishes: [...wishes],
    };
    // saved exclusively (under a per-account Web Lock, then read back): two tabs that both passed the first check
    // cannot both reach the wallet, and neither overwrites the other's intent
    const write = () => pendingStore.persistExclusive(intent, conflict, store);
    const saved0 = deps.withLock ? await deps.withLock(`everlight-buy-${deps.account.toLowerCase()}`, write) : write();
    if (saved0 === "busy" || saved0 === "conflict") return fail(DUPLICATE_MESSAGE);
    if (saved0 !== "saved") return fail(STORAGE_MESSAGE);
    onStep({ name: "buy-wallet" });
    let hash: Hash;
    try {
      hash = await deps.buy(request);
    } catch (e) {
      if (isProvenRejection(e)) {
        pendingStore.remove(ih, deps.storage); // proven: the wallet refused before signing, nothing to recover
        throw e;
      }
      // a disconnect (4900/4901), a timeout or an unknown failure: the wallet may have broadcast the purchase and lost
      // its hash. The intent stays saved and the draft stays locked until the purchase is found, its hash is pasted
      // and validated, or the user confirms the cancellation.
      const s: Step = { name: "buy-unknown", hash: ih, message: AMBIGUOUS_MESSAGE };
      onStep(s);
      return s;
    }
    // from here on the purchase is broadcast: no failure may unlock the draft as if nothing had been sent
    sent = {
      hash, kind: "buy", account: deps.account, quantity: styles.length, createdAt: Date.now(),
      from: deps.account, nonce: sub.nonce, block: sub.block.toString(), nonceChecked: false, styles: [...styles], wishes: [...wishes],
    };
    const saved = pendingStore.replace(ih, sent, deps.storage);
    onStep({ name: "buy-pending", hash });
    const checked = saved ? await reconcileSent(deps, sent) : await reconcileSent(deps, sent).catch(() => sent!);
    const s = await awaitBuy(deps, checked, onStep);
    // settled: an intent that could not be overwritten with the hash is no longer needed
    if (s.name !== "buy-unknown") pendingStore.remove(ih, deps.storage);
    return s;
  } catch (e) {
    if (sent) {
      // a failure after broadcast (storage, RPC): keep the hash pending and the draft locked, never a plain error
      pendingStore.replace(buyIntentHash(deps.account), sent, deps.storage);
      const s: Step = { name: "buy-unknown", hash: sent.hash, message: SENT_UNKNOWN_MESSAGE };
      onStep(s);
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
  "Your purchase was sent, but the page could not finish tracking it. It stays locked on this transaction so it is not sent twice; check its receipt below.";

export const INTENT_PENDING_MESSAGE =
  "A purchase was waiting for your wallet's confirmation when the page closed, and its nonce has not been used yet, so it may still be pending in your wallet. This draft stays locked so it is not sent twice. Check again, or release it if your wallet shows no pending purchase.";

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
      if (pendingStore.list(deps.storage).some((t) => t.hash === tx.hash)) pendingStore.add(next, deps.storage);
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
  // an unverified receipt keeps the hash saved (and the draft locked) so verification can be retried
  if (s.name !== "buy-unknown") pendingStore.remove(tx.hash, deps.storage);
  if (s.name === "done" && r.purchase) deps.remember?.(r.purchase.firstId, r.purchase.quantity, s.hash);
  onStep(s);
  return s;
}
