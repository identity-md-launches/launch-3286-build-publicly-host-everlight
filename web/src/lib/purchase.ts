import type { Hash } from "viem";

export type TxKind = "approve" | "buy" | "claim";

export interface PendingTx {
  hash: Hash;
  kind: TxKind;
  account: string;
  quantity?: number;
  createdAt: number;
}

const PENDING_KEY = "everlight:v1:pending";

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
  },
  remove(hash: string, storage: Storage | null = safeStorage()) {
    storage?.setItem(PENDING_KEY, JSON.stringify(pendingStore.list(storage).filter((t) => t.hash !== hash)));
  },
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
  | { name: "done"; hash: Hash; firstId: number | null }
  | { name: "error"; message: string };

/** Everything the purchase needs from a chain. The UI passes wagmi/viem; tests pass labelled mocks. */
export interface PurchaseDeps {
  account: string;
  chainId: () => number;
  salesOpen: () => Promise<boolean>;
  balance: () => Promise<bigint>;
  allowance: () => Promise<bigint>;
  ethBalance: () => Promise<bigint>;
  approve: (amount: bigint) => Promise<Hash>;
  /** Resolves with success or reverted; throws only on RPC failure. */
  wait: (hash: Hash) => Promise<{ status: "success" | "reverted"; firstId?: number | null }>;
  simulate: (styles: number[], wishes: string[]) => Promise<unknown>;
  buy: (request: unknown) => Promise<Hash>;
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
    onStep({ name: "buy-wallet" });
    const hash = await deps.buy(request);
    pendingStore.add({ hash, kind: "buy", account: deps.account, quantity: styles.length, createdAt: Date.now() }, deps.storage);
    onStep({ name: "buy-pending", hash });
    const r = await deps.wait(hash);
    pendingStore.remove(hash, deps.storage);
    if (r.status !== "success") return fail("The purchase reverted onchain. Your IMD was not taken; only gas was spent.");
    const done: Step = { name: "done", hash, firstId: r.firstId ?? null };
    onStep(done);
    return done;
  } catch (e) {
    return fail(deps.explain(e));
  }
}
