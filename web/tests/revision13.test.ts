// @vitest-environment jsdom
/**
 * Revision 13 regression tests. MOCKED: labelled in-memory storage shared by simulated tabs, mock wallets and mock RPC
 * clients; nothing here talks to a chain or a wallet. One block per reviewer finding.
 */
import { describe, expect, it } from "vitest";
import { encodeFunctionData, erc20Abi, type Hash } from "viem";
import {
  APPROVAL_AMBIGUOUS_MESSAGE, DUPLICATE_MESSAGE, INTENT_PENDING_MESSAGE, WALLET_CHANGED_MESSAGE,
  buyIntentHash, pendingStore, runPurchase, storedEntries, type PendingTx, type PurchaseDeps, type Step,
} from "../src/lib/purchase";
import { attachHash } from "../src/lib/chain";
import { runClaim } from "../src/lib/claim";
import { intentHash, matchesIntent } from "../src/lib/intent";
import { IncompleteIdsError, liveSource } from "../src/lib/candles";
import { actorFrames, actorsOf } from "../src/garden/ambient";
import { pathY, sectorPlan } from "../src/garden/layout";
import { terraceJoins } from "../src/garden/scenery";
import { GARDEN, IMD } from "../src/config";
import { wishGardenAbi } from "../src/abi/WishGarden";

class SharedStorage {
  m = new Map<string, string>();
  onGet: ((k: string) => void) | null = null;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { this.onGet?.(k); return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const asS = (s: SharedStorage) => s as unknown as Storage;
const ME = "0x00000000000000000000000000000000000000a1";
const H = (c: string) => (`0x${c.repeat(64)}`.slice(0, 66)) as Hash;
const err = (code: number, message: string) => Object.assign(new Error(message), { code });
function deferred<T>() { let res!: (v: T) => void; const p = new Promise<T>((a) => { res = a; }); return { p, res }; }
let seq = 0;
function deps(st: SharedStorage, over: Partial<PurchaseDeps> = {}): PurchaseDeps {
  return {
    account: ME, chainId: () => 1, salesOpen: async () => true,
    balance: async () => 10n ** 20n, allowance: async () => 10n ** 20n, ethBalance: async () => 10n ** 18n,
    approve: async () => H("a"), wait: async () => ({ status: "success" }), simulate: async () => ({ req: true }),
    buy: async () => H("b"), submission: async () => ({ nonce: 7, block: 100n }),
    walletState: async () => ({ account: ME, chainId: 1 }), explain: (e) => (e instanceof Error ? e.message : String(e)),
    storage: asS(st), newAttempt: () => `r13-${++seq}`, ...over,
  };
}
const buyIntent = (attempt: string, createdAt = 1): PendingTx => ({ hash: buyIntentHash(ME), kind: "buy", intent: true, account: ME, createdAt, from: ME, nonce: 7, block: "100", styles: [1], wishes: ["w"], attempt });

describe("50a3d6d8: an approval that may have been sent keeps a recovery record", () => {
  it("4900 from approve: one saved approval intent (account, chain, token, spender, amount, nonce), one wallet request", async () => {
    const st = new SharedStorage();
    let asked = 0;
    const d = deps(st, { allowance: async () => 0n, approve: async () => { asked++; throw err(4900, "Disconnected"); } });
    const a = await runPurchase(d, [1], ["w"], () => {});
    expect(a).toMatchObject({ name: "approve-unknown", message: APPROVAL_AMBIGUOUS_MESSAGE });
    const saved = storedEntries(asS(st));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ kind: "approve", intent: true, account: ME, chainId: 1, token: IMD, spender: GARDEN, amount: (10n ** 18n).toString(), nonce: 7, block: "100", hash: intentHash("approve", ME) });
    const b = await runPurchase(d, [1], ["w"], () => {});
    expect(b).toMatchObject({ name: "error", message: DUPLICATE_MESSAGE });
    expect(asked).toBe(1);
  });
  it("a proven rejection (4001) clears only its own approval attempt", async () => {
    const st = new SharedStorage();
    pendingStore.persist(buyIntent("other-account-claim", 1), asS(st)); // unrelated? same account buy blocks; use claim instead
    pendingStore.removeAttempt("other-account-claim", asS(st));
    pendingStore.persist({ hash: intentHash("claim", ME), kind: "claim", intent: true, account: ME, createdAt: 2, attempt: "claim-x" }, asS(st));
    const r = await runPurchase(deps(st, { allowance: async () => 0n, approve: async () => { throw err(4001, "User rejected"); } }), [1], ["w"], () => {});
    expect(r.name).toBe("error");
    expect(storedEntries(asS(st)).map((t) => t.attempt)).toEqual(["claim-x"]);
  });
  it("a pasted approval hash is matched only as this exact IMD approve(garden, amount)", () => {
    const intent: PendingTx = { hash: intentHash("approve", ME), kind: "approve", intent: true, account: ME, createdAt: 1, nonce: 7, token: IMD, spender: GARDEN, amount: "1000000000000000000" };
    const input = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GARDEN, 10n ** 18n] });
    expect(matchesIntent(intent, { hash: H("c"), from: ME, to: IMD, input, nonce: 8, chainId: 1 }).ok).toBe(true);
    expect(matchesIntent(intent, { hash: H("c"), from: ME, to: GARDEN, input, nonce: 8, chainId: 1 }).ok).toBe(false);
    const other = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GARDEN, 2n * 10n ** 18n] });
    expect(matchesIntent(intent, { hash: H("c"), from: ME, to: IMD, input: other, nonce: 8, chainId: 1 }).ok).toBe(false);
  });
});

describe("275eb15b: settling one attempt can never erase another tab's newer intent", () => {
  it("tab A's cleanup of A interleaved with tab B settling A and saving B leaves exactly [B]", () => {
    const st = new SharedStorage();
    pendingStore.persist(buyIntent("A", 1), asS(st));
    let injected = false;
    // pause tab A's removal at its first storage read; tab B settles A and saves B as a new uncertain intent
    st.onGet = () => {
      if (injected) return;
      injected = true;
      st.onGet = null;
      pendingStore.removeAttempt("A", asS(st));
      pendingStore.persist(buyIntent("B", 2), asS(st));
    };
    pendingStore.removeAttempt("A", asS(st));
    expect(injected).toBe(true);
    expect(storedEntries(asS(st)).map((t) => t.attempt)).toEqual(["B"]);
  });
  it("a delayed compare-and-update of a settled attempt withdraws its own write (no resurrection)", () => {
    const st = new SharedStorage();
    pendingStore.persist(buyIntent("A", 1), asS(st));
    let fired = false;
    st.onGet = (k) => { if (!fired && k.includes(":x:")) { fired = true; st.onGet = null; pendingStore.removeAttempt("A", asS(st)); } };
    pendingStore.update("A", (t) => ({ ...t, nonce: 9 }), asS(st));
    expect(storedEntries(asS(st))).toHaveLength(0);
  });
  it("entries saved by an earlier build as one list are migrated, not lost", () => {
    const st = new SharedStorage();
    st.setItem("everlight:v2:pending:0x33a514c5e2028f1affd70b82f170e8193df030a5", JSON.stringify([buyIntent("L", 1)]));
    pendingStore.persist(buyIntent("N", 2), asS(st));
    expect(storedEntries(asS(st)).map((t) => t.attempt)).toEqual(["L", "N"]);
  });
});

describe("84db2ace: a delayed Match never restores a settled attempt", () => {
  it("A's lookup resolves after tab B settled A and saved B: no-op, storage stays [B]", async () => {
    const st = new SharedStorage();
    const A = buyIntent("A", 1);
    pendingStore.persist(A, asS(st));
    const look = deferred<null | { hash: Hash; from: string; to: string; input: `0x${string}`; nonce: number; chainId: number }>();
    const p = attachHash(A, H("9"), { tx: () => look.p }, asS(st));
    pendingStore.removeAttempt("A", asS(st));
    pendingStore.persist(buyIntent("B", 2), asS(st));
    look.res({ hash: H("9"), from: ME, to: GARDEN, input: encodeFunctionData({ abi: wishGardenAbi, functionName: "buyCandles", args: [[1], ["w"]] }), nonce: 9, chainId: 1 });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ settled: true, current: null });
    expect(storedEntries(asS(st)).map((t) => t.attempt)).toEqual(["B"]);
  });
  it("an undisturbed Match returns the updated entry with the real hash", async () => {
    const st = new SharedStorage();
    const A = buyIntent("A2", 1);
    pendingStore.persist(A, asS(st));
    const r = await attachHash(A, H("8"), { tx: async () => ({ hash: H("8"), from: ME, to: GARDEN, input: encodeFunctionData({ abi: wishGardenAbi, functionName: "buyCandles", args: [[1], ["w"]] }), nonce: 9, chainId: 1 }) }, asS(st));
    expect(r.ok && r.tx.hash).toBe(H("8"));
    expect(storedEntries(asS(st))[0]).toMatchObject({ hash: H("8"), nonce: 9, nonceChecked: true, attempt: "A2" });
  });
});

describe("ac79a2a0: a wallet switched away and back during preparation never sends", () => {
  it("A/Ethereum -> B/Base -> A/Ethereum during simulation: zero buy requests until a fresh click", async () => {
    const st = new SharedStorage();
    let rev = 0, sends = 0;
    const sim = deferred<unknown>();
    const d = deps(st, { simulate: () => sim.p, buy: async () => { sends++; return H("b"); }, binding: { revision: () => rev, connector: "c1" }, walletState: async () => ({ account: ME, chainId: 1, connector: "c1" }) });
    const p = runPurchase(d, [1], ["w"], () => {});
    await new Promise((r) => setTimeout(r, 0));
    rev++; // account B on Base observed
    rev++; // back to A on Ethereum
    sim.res({ req: true });
    const s = await p;
    expect(s).toMatchObject({ name: "error", message: WALLET_CHANGED_MESSAGE });
    expect(sends).toBe(0);
    expect(storedEntries(asS(st))).toHaveLength(0);
  });
  it("a different connector with the same account and chain also ends the attempt", async () => {
    const st = new SharedStorage();
    let sends = 0;
    const s = await runPurchase(deps(st, { buy: async () => { sends++; return H("b"); }, binding: { revision: () => 0, connector: "c1" }, walletState: async () => ({ account: ME, chainId: 1, connector: "c2" }) }), [1], ["w"], () => {});
    expect(s).toMatchObject({ message: WALLET_CHANGED_MESSAGE });
    expect(sends).toBe(0);
  });
  it("claims: a revision change before the send ends the claim with nothing sent", async () => {
    const st = new SharedStorage();
    let rev = 0, sends = 0;
    const s = await runClaim({ account: ME, storage: asS(st), simulate: async () => { rev++; return {}; }, submission: async () => ({ nonce: 1, block: 1n }),
      send: async () => { sends++; return H("c"); }, wait: async (h) => ({ ok: true, hash: h }), explain: String, walletState: async () => ({ account: ME, chainId: 1 }), binding: { revision: () => rev } }, () => {});
    expect(s).toMatchObject({ s: "error", msg: WALLET_CHANGED_MESSAGE });
    expect(sends).toBe(0);
  });
});

describe("7b012048: My Candles reconciles pages with the verified owner count", () => {
  it("count 101, a full first page and an empty second page: incomplete, 100 IDs kept, retry resumes at offset 100", async () => {
    const reads: bigint[] = [];
    let healthy = false;
    const client = { readContract: async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === "candleCountOf") return 101n;
      const off = args[1] as bigint; reads.push(off);
      if (off === 0n) return [Array.from({ length: 100 }, (_, i) => BigInt(i + 1)), 100n];
      return healthy ? [[101n], 101n] : [[], 100n];
    } };
    const src = liveSource(client, wishGardenAbi);
    const e = await src.idsOf(ME).catch((x) => x);
    expect(e).toBeInstanceOf(IncompleteIdsError);
    expect((e as IncompleteIdsError).ids).toHaveLength(100);
    expect((e as IncompleteIdsError).nextOffset).toBe(100n);
    healthy = true;
    reads.length = 0;
    const ids = await src.idsOf(ME);
    expect(ids).toHaveLength(101);
    expect(reads).toEqual([100n]); // resumed at the first missing offset
  });
});

describe("4248029a: a purchase-only click never opens an approval after a revocation", () => {
  it("quote said covered, live allowance 0: no wallet request, the new allowance is returned for a fresh Approve click", async () => {
    const st = new SharedStorage();
    let approvals = 0, buys = 0;
    const s = await runPurchase(deps(st, { allowance: async () => 0n, approve: async () => { approvals++; return H("a"); }, buy: async () => { buys++; return H("b"); }, expectApproval: false }), [1], ["w"], () => {});
    expect(approvals + buys).toBe(0);
    expect(s).toMatchObject({ name: "error", allowance: { allowance: 0n } });
    expect((s as Extract<Step, { name: "error" }>).message).toContain('Approve exactly 1 IMD');
    expect(storedEntries(asS(st))).toHaveLength(0);
  });
});

describe("6f9f3673: recovery wording names only actions that exist", () => {
  it("the pending message offers Check again and the hash, never a release", () => {
    expect(INTENT_PENDING_MESSAGE).toBe("This transaction may have been sent. Check again, or paste the transaction hash from your wallet's activity. The action stays locked until the transaction can be verified.");
    expect(INTENT_PENDING_MESSAGE).not.toMatch(/release/i);
  });
});

describe("73c16e3d: lantern carriers and path walkers follow the winding path", () => {
  it("every walking sample of every lantern carrier stays within 3 world units of the path centre line (+offset)", () => {
    let worst = 0, n = 0;
    for (let s = 0; s < 64; s++) {
      const gy = sectorPlan(s).gy;
      for (const a of actorsOf(s)) {
        if (a.kind !== "lantern" && a.kind !== "walker") continue;
        for (let t = 0; t < 40000; t += 120) {
          const f = actorFrames(a, t, false)[0];
          if (!f.frame.startsWith("lantern") && !f.frame.startsWith("walk")) continue;
          n++;
          worst = Math.max(worst, Math.abs(f.y - pathY(gy, f.x)) - 4);
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    expect(worst).toBeLessThanOrEqual(0.001);
  });
});

describe("3adbef8e: stacked candle beds share connected ground", () => {
  it("sectors with stacked beds get shared landings, and slot coordinates are unchanged by them", () => {
    let joins = 0;
    for (let s = 0; s < 64; s++) {
      const plan = sectorPlan(s);
      const before = JSON.stringify(plan.slots);
      joins += terraceJoins(plan.terraces).length;
      expect(JSON.stringify(sectorPlan(s).slots)).toBe(before);
    }
    expect(joins).toBeGreaterThan(10);
  });
});
