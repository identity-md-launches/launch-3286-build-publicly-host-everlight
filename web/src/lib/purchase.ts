import type { Hash } from "viem";

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
  /** The exact draft that was signed (buy only): a replacement must carry the same calldata and events. */
  styles?: number[];
  wishes?: string[];
}

const PENDING_KEY = "everlight:v1:pending";
const pendingSubs = new Set<() => void>();
let pendingVersion = 0;
const pendingChanged = () => { pendingVersion++; pendingSubs.forEach((f) => f()); };

/** Pending transaction hashes survive reloads so a closed tab can recover its receipt. */
export const pendingStore = {
  list(storage: Storage | null = safeStorage()): PendingTx[] {
    try {
      const v = JSON.parse(storage?.getItem(PENDING_KEY) ?? "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  },
  add(tx: PendingTx, storage: Storage | null = safeStorage()) {
    const l = pendingStore.list(storage).filter((t) => t.hash !== tx.hash);
    storage?.setItem(PENDING_KEY, JSON.stringify([...l, tx]));
    pendingChanged();
  },
  remove(hash: string, storage: Storage | null = safeStorage()) {
    storage?.setItem(PENDING_KEY, JSON.stringify(pendingStore.list(storage).filter((t) => t.hash !== hash)));
    pendingChanged();
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
  | { name: "done"; hash: Hash; firstId: number | null }
  | { name: "error"; message: string };

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

/**
 * A purchase is complete only when its mined receipt succeeded and carries the garden's CandlesPurchased
 * event for this buyer and quantity. The mined hash (a sped-up replacement's, if any) is the one linked.
 */
export function settleBuy(r: Receipt, sent: Hash, account: string, quantity?: number, draft?: Draft): Step {
  if (r.status !== "success") return { name: "error", message: "The purchase reverted onchain. Your IMD was not taken; only gas was spent." };
  const ev = r.purchase;
  const q = draft ? draft.styles.length : quantity;
  if (!ev || ev.purchaser.toLowerCase() !== account.toLowerCase() || (q !== undefined && ev.quantity !== q)) {
    return { name: "error", message: REPLACED_MESSAGE };
  }
  if (draft) {
    // the mined transaction (the sent one or its replacement) must be this account calling buyCandles with
    // exactly the signed styles and wishes, and the garden must have created exactly those candles in order
    if (r.from !== undefined && r.from.toLowerCase() !== account.toLowerCase()) return { name: "error", message: REPLACED_MESSAGE };
    if (r.call !== undefined && (!r.call || !same(r.call.styles, draft.styles) || !same(r.call.wishes, draft.wishes))) return { name: "error", message: REPLACED_MESSAGE };
    if (r.created !== undefined) {
      const c = [...r.created].sort((a, b) => a.id - b.id);
      const ok = c.length === draft.styles.length && c.every((x, i) => x.id === ev.firstId + i && x.purchaser.toLowerCase() === account.toLowerCase() && x.style === draft.styles[i] && x.wish === draft.wishes[i]);
      if (!ok) return { name: "error", message: REPLACED_MESSAGE };
    }
  }
  return { name: "done", hash: r.hash ?? sent, firstId: ev.firstId };
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
  /** Sender nonce and current block read just before the purchase is requested (for bounded recovery). */
  submission?: () => Promise<{ nonce: number; block: bigint }>;
  explain: (e: unknown) => string;
  storage?: Storage | null;
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
  const fail = (message: string): Step => {
    const s: Step = { name: "error", message };
    onStep(s);
    return s;
  };
  try {
    if (styles.length < 1 || styles.length > 50 || styles.length !== wishes.length) return fail("Choose between 1 and 50 candles.");
    if (deps.chainId() !== 1) return fail("Your wallet is on another network. Switch to Ethereum to continue.");
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
      if ((await deps.allowance()) < total) return fail("The approval did not reach the required total. Approve again.");
    }
    onStep({ name: "simulating" });
    const request = await deps.simulate(styles, wishes);
    const sub = await deps.submission?.().catch(() => undefined);
    onStep({ name: "buy-wallet" });
    const hash = await deps.buy(request);
    const tx: PendingTx = {
      hash, kind: "buy", account: deps.account, quantity: styles.length, createdAt: Date.now(),
      from: deps.account, nonce: sub?.nonce, block: sub?.block.toString(), styles: [...styles], wishes: [...wishes],
    };
    pendingStore.add(tx, deps.storage);
    onStep({ name: "buy-pending", hash });
    return await awaitBuy(deps, tx, onStep);
  } catch (e) {
    return fail(deps.explain(e));
  }
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
  pendingStore.remove(tx.hash, deps.storage);
  const draft = tx.styles && tx.wishes && tx.styles.length === tx.wishes.length ? { styles: tx.styles, wishes: tx.wishes } : undefined;
  const s = settleBuy(r, tx.hash, tx.account, tx.quantity, draft);
  if (s.name === "done" && r.purchase) deps.remember?.(r.purchase.firstId, r.purchase.quantity, s.hash);
  onStep(s);
  return s;
}
