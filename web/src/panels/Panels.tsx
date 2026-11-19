import { minedTx, sentTx, settleReceipt, submissionMeta } from "../lib/chain";
import { settleClaim } from "../lib/receipt";
import { WrongNetwork } from "../components/WrongNetwork";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { wishGardenAbi } from "../abi/WishGarden";
import { BASESCAN, BASE_IMD, BASE_RECEIVER, ETHERSCAN, GARDEN, GARDEN_DEPLOY_BLOCK, IMD, LEGACY_GARDEN, OWNER, SOURCE_REPO, config } from "../config";
import { STYLE_NAMES, date, imd, short, safeChecksum } from "../lib/format";
import { explainError } from "../lib/errors";
import { FIXTURE_MESSAGE, pendingStore, reconcileSent, type PendingTx } from "../lib/purchase";
import type { Candle } from "../lib/candles";
import { ConnectButton } from "../components/ConnectSheet";
import { FIXTURE, useActivity, useCandleTx, useMyIds, useRewards, useTreasury } from "../hooks";

const addrLink = (a: string, base = ETHERSCAN) => (
  <a href={`${base}/address/${a}`} target="_blank" rel="noreferrer">{short(a)}</a>
);

/** Candle details. Wish text renders as a React text node, never as HTML. */
function CopyAddress({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="link copy" onClick={() => navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }, () => setDone(false))}>
      {done ? "Copied" : "Copy address"}
    </button>
  );
}

function TxCell({ c }: { c: Candle }) {
  const tx = useCandleTx(c);
  if (FIXTURE !== null) return <>None: simulated candle</>;
  if (tx.isLoading) return <>Looking up…</>;
  if (!tx.data) return <>Transaction unavailable</>;
  return <a href={`${ETHERSCAN}/tx/${tx.data}`} target="_blank" rel="noreferrer">{short(tx.data)} ↗</a>;
}

export function CandleDetail({ c, onClose, mine }: { c: Candle; onClose: () => void; mine: boolean }) {
  return (
    <section className="detail" aria-labelledby="detail-title">
      <div className="sheet-head">
        <h2 id="detail-title">Candle #{c.id}</h2>
        <button className="x" aria-label="Close candle details" onClick={onClose}>×</button>
      </div>
      {c.wish ? <blockquote className="wish">{c.wish}</blockquote> : <p className="muted">No wish was written for this candle.</p>}
      <div className="detail-body">
        <img className="px" src={`./art/px/candle-${c.style}.png`} alt="" width={40} height={64} />
        <dl className="kv">
          <div><dt>Owner</dt><dd>{FIXTURE === null ? addrLink(c.purchaser) : short(c.purchaser)}{mine ? " (you)" : ""}</dd></div>
          <div><dt>Style</dt><dd>{STYLE_NAMES[c.style] ?? `Style ${c.style}`}</dd></div>
          <div><dt>Lit</dt><dd>{date(c.createdAt)}</dd></div>
          <div><dt>Position</dt><dd>{c.position}</dd></div>
          <div><dt>Transaction</dt><dd><TxCell c={c} /></dd></div>
        </dl>
      </div>
      <p className="full-addr"><code>{c.purchaser}</code> <CopyAddress value={c.purchaser} /></p>
      {FIXTURE === null
        ? (
          <p className="links">
            <a className="onchain" href={`${ETHERSCAN}/address/${GARDEN}#readContract`} target="_blank" rel="noreferrer">View onchain (getCandle {c.id}) ↗</a>
            <a href={`${ETHERSCAN}/address/${c.purchaser}`} target="_blank" rel="noreferrer">Owner on Etherscan ↗</a>
            <a href={`${ETHERSCAN}/advanced-filter?fadd=${c.purchaser}&tadd=${GARDEN}`} target="_blank" rel="noreferrer">Owner's garden transactions ↗</a>
          </p>
        )
        : <p className="fine">Simulated fixture candle: not onchain.</p>}
    </section>
  );
}

export function MinePanel({ candles, onJump, highlight, setHighlight }: { candles: Candle[]; onJump: (id: number) => void; highlight: boolean; setHighlight: (v: boolean) => void }) {
  const { address } = useAccount();
  const ids = useMyIds(address);
  const [page, setPage] = useState(0);
  const per = 25;
  const pages = Math.max(1, Math.ceil((ids.data?.length ?? 0) / per));
  // A different wallet starts on its first page; a shrinking list never leaves the view past its end.
  useEffect(() => setPage(0), [address]);
  useEffect(() => setPage((p) => Math.min(p, pages - 1)), [pages]);
  if (!address)
    return (
      <section aria-labelledby="mine-title">
        <h2 id="mine-title">My candles</h2>
        <p>Connect a wallet to list the candles it lit. Anyone can still find a candle by its number with Find candle.</p>
        <ConnectButton />
      </section>
    );
  const list = ids.data ?? [];
  const current = Math.min(page, pages - 1);
  const shown = list.slice(current * per, current * per + per);
  return (
    <section aria-labelledby="mine-title">
      <h2 id="mine-title">My candles</h2>
      {ids.isLoading && <p role="status">Reading your candles…</p>}
      {ids.isError && <p className="bad" role="alert">Your candles could not be read. <button className="link" onClick={() => ids.refetch()}>Try again</button></p>}
      {ids.data && list.length === 0 && <p>This wallet has not lit a candle yet. Open Light a candle to add the first.</p>}
      {list.length > 0 && (
        <>
          <label className="check">
            <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
            <span>Ring my {list.length} candles in the garden</span>
          </label>
          <ul className="list">
            {shown.map((id) => {
              const c = candles[id - 1];
              return (
                <li key={id}>
                  <button className="row" onClick={() => onJump(id)}>
                    <span className="num">#{id}</span>
                    <span className="grow">{c ? (c.wish ? c.wish : STYLE_NAMES[c.style]) : "Loading…"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Pager page={current} pages={pages} setPage={setPage} />
        </>
      )}
    </section>
  );
}

export function Pager({ page, pages, setPage }: { page: number; pages: number; setPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pages">
      <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page + 1} of {pages}</span>
      <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
    </nav>
  );
}

/** Every candle stays discoverable without the canvas: a paged register in id order. */
/** What the register knows about the live count: an empty list is a verified empty garden only when total is 0. */
export interface RegisterInfo { total: number | null; loading: boolean; error: string | null; updatedAt: number | null }

export function Register({ candles, info, onRetry, onJump }: { candles: Candle[]; info: RegisterInfo; onRetry: () => void; onJump: (id: number) => void }) {
  const [page, setPage] = useState(0);
  const per = 25;
  const pages = Math.max(1, Math.ceil(candles.length / per));
  const shown = candles.slice(page * per, page * per + per);
  const { total, loading, error, updatedAt } = info;
  const partial = total !== null && candles.length < total;
  const when = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <section aria-labelledby="reg-title">
      <h2 id="reg-title">Candle register</h2>
      {error && (
        <p className="bad" role="alert">
          {candles.length > 0
            ? `The latest candles could not be read (${when ? `last updated ${when}` : "showing cached records"}). ${total !== null ? `Showing ${candles.length} of ${total} candles. ` : ""}The list may be incomplete. `
            : total !== null && total > 0
              ? `Showing 0 of ${total} candles. The first page could not be loaded. `
              : "Unavailable: the candle count could not be read from Ethereum. This does not mean the garden is empty. "}
          <button type="button" className="link" onClick={onRetry} disabled={loading}>{loading ? "Trying…" : "Try again"}</button>
        </p>
      )}
      {!error && total === null && candles.length === 0 && <p role="status">Reading the candle register from Ethereum…</p>}
      {!error && total !== null && total > 0 && candles.length === 0 && <p className="fine" role="status">Showing 0 of {total} candles, loading the first page…</p>}
      {total === 0 && candles.length === 0 && !error && <p>No candle has been lit yet. Every holder in the garden is empty and waiting.</p>}
      {candles.length > 0 && (
        <>
          {!error && (partial || total === null) && (
            <p className="fine" role="status">
              {total === null ? `Showing ${candles.length} saved candles; the current total is not confirmed yet.` : `Showing ${candles.length} of ${total} candles${loading ? ", loading the rest…" : "."}`}
            </p>
          )}
          <ul className="list">
            {shown.map((c) => (
              <li key={c.id}>
                <button className="row" onClick={() => onJump(c.id)}>
                  <span className="num">#{c.id}</span>
                  <span className="grow">{c.wish || STYLE_NAMES[c.style]}</span>
                </button>
              </li>
            ))}
          </ul>
          <Pager page={page} pages={pages} setPage={setPage} />
        </>
      )}
    </section>
  );
}

/**
 * Settle a claim sent earlier (after a reload, or from Check again): follows a replacement from the saved sender and
 * nonce, and counts it only with the garden's RewardsClaimed event for this account. The saved hash is removed only
 * once the outcome is known; an unverified or missing receipt keeps it, so Claim stays locked on it.
 */
export async function checkClaim(tx: PendingTx): Promise<{ ok: boolean; text: string; href: string; settled: boolean }> {
  try {
    const { receipt: r, mined } = await settleReceipt(tx.hash, tx);
    const v = settleClaim(r, mined, tx.account);
    const unverified = "unverified" in v && !!v.unverified;
    if (!unverified) pendingStore.remove(tx.hash);
    return { ok: v.ok, settled: !unverified, href: `${ETHERSCAN}/tx/${r.transactionHash}`, text: v.ok ? `Your earlier claim confirmed: ${imd(v.amount)} IMD claimed.` : v.message };
  } catch {
    return { ok: false, settled: false, href: `${ETHERSCAN}/tx/${tx.hash}`, text: "The claim sent earlier has no receipt yet. It is still saved and Claim stays off until it settles." };
  }
}

type ClaimState = { s: "idle" } | { s: "wallet" } | { s: "pending"; hash: string } | { s: "done"; hash: string; amount: bigint } | { s: "error"; msg: string };

export function RewardsPanel() {
  const { address, chainId } = useAccount();
  const r = useRewards(address);
  const qc = useQueryClient();
  const [st, setSt] = useState<ClaimState>({ s: "idle" });
  const busy = useRef(false);
  // a claim sent earlier by this wallet to this garden (this page or before a reload) that has not settled yet:
  // Claim stays off until it does, so the same rewards are never requested twice
  const pendingVersion = useSyncExternalStore(pendingStore.subscribe, pendingStore.version);
  const pendingClaim = useMemo(
    () => (address ? pendingStore.list().filter((t) => t.kind === "claim" && t.account.toLowerCase() === address.toLowerCase()).at(-1) ?? null : null),
    [pendingVersion, address],
  );
  const [checking, setChecking] = useState(false);
  async function recheck() {
    if (!pendingClaim || checking) return;
    setChecking(true);
    const v = await checkClaim(pendingClaim);
    setChecking(false);
    if (v.settled) setSt(v.ok ? { s: "idle" } : { s: "error", msg: v.text });
    qc.invalidateQueries();
  }
  async function claim() {
    if (busy.current || !address) return;
    if (pendingStore.list().some((t) => t.kind === "claim" && t.account.toLowerCase() === address.toLowerCase())) return; // duplicate-claim guard
    if (FIXTURE !== null) return setSt({ s: "error", msg: FIXTURE_MESSAGE }); // fixture pages never reach the wallet
    busy.current = true;
    try {
      setSt({ s: "wallet" });
      const { request } = await simulateContract(config, { address: GARDEN, abi: wishGardenAbi, functionName: "claimRewards", account: address, chainId: 1 });
      // the nonce and submission block are read before signing: without them a replaced claim could not be recovered
      const sub = await submissionMeta(address).catch(() => null);
      if (!sub) { setSt({ s: "error", msg: "Your account's nonce and the current block could not be read. Nothing was sent; try the claim again." }); return; }
      const hash = await writeContract(config, request);
      const saved = { hash, kind: "claim" as const, account: address, createdAt: Date.now(), from: address, nonce: sub.nonce, block: sub.block.toString(), nonceChecked: false };
      pendingStore.add(saved);
      setSt({ s: "pending", hash });
      // reconcile the preflight nonce with the submitted transaction's own, for recovery after a reload
      await reconcileSent({ sentTx }, saved);
      // follows a sped-up or cancelled replacement; only a verified RewardsClaimed from the garden shows Claimed
      const rec = await waitForTransactionReceipt(config, { hash, chainId: 1 });
      const v = settleClaim(rec, await minedTx(rec.transactionHash), address);
      if (!("unverified" in v && v.unverified)) pendingStore.remove(hash); // unverified: kept and re-checked on reload
      setSt(v.ok ? { s: "done", hash: rec.transactionHash, amount: v.amount } : { s: "error", msg: v.message });
      qc.invalidateQueries();
    } catch (e) {
      setSt({ s: "error", msg: explainError(e) });
    } finally {
      busy.current = false;
    }
  }
  const d = r.data;
  return (
    <section aria-labelledby="rewards-title">
      <h2 id="rewards-title">Rewards</h2>
      <p className="lede">60% of every new candle (0.60 IMD) is shared equally among all earlier candles, counted per candle rather than per wallet. Rewards depend entirely on later purchases: with no new purchases there are no new rewards, and there is no fixed yield or guaranteed profit.</p>
      {!address && <><p>Connect a wallet to read its reward state. Claims stay open even while sales are closed.</p><ConnectButton /></>}
      {address && r.isLoading && <p role="status">Reading your rewards…</p>}
      {address && r.isError && <p className="bad" role="alert">Rewards could not be read. <button className="link" onClick={() => r.refetch()}>Try again</button></p>}
      {d && (
        <dl className="summary">
          <div><dt>Your candles</dt><dd>{d.candles.toString()}</dd></div>
          <div><dt>Earned</dt><dd>{imd(d.earned)} IMD</dd></div>
          <div><dt>Claimed</dt><dd>{imd(d.claimed)} IMD</dd></div>
          <div><dt>Claimable now</dt><dd>{imd(d.claimable)} IMD</dd></div>
        </dl>
      )}
      {d && (
        <button className="cta wide" onClick={claim} disabled={FIXTURE !== null || d.claimable === 0n || chainId !== 1 || st.s === "wallet" || st.s === "pending" || pendingClaim !== null}>
          {st.s === "wallet" ? "Confirm in your wallet…" : st.s === "pending" ? "Claiming…" : pendingClaim ? "Waiting for the earlier claim" : d.claimable === 0n ? "Nothing to claim yet" : `Claim ${imd(d.claimable)} IMD`}
        </button>
      )}
      {address && chainId !== 1 && <WrongNetwork action="claim" />}
      <div aria-live="polite" className="steps">
        {st.s === "pending" && <p>Claim sent. Waiting for its receipt… <a href={`${ETHERSCAN}/tx/${st.hash}`} target="_blank" rel="noreferrer">View transaction</a></p>}
        {st.s === "done" && <p>Claimed {imd(st.amount)} IMD. <a href={`${ETHERSCAN}/tx/${st.hash}`} target="_blank" rel="noreferrer">View transaction</a></p>}
        {st.s === "error" && <p className="bad" role="alert">{st.msg}</p>}
        {pendingClaim && st.s !== "pending" && st.s !== "wallet" && (
          <div className="pending-box" role="status">
            <p>
              A claim sent earlier has no settled receipt yet. Claim stays off until it settles, so the same rewards are not requested twice.{" "}
              <a href={`${ETHERSCAN}/tx/${pendingClaim.hash}`} target="_blank" rel="noreferrer">View pending claim</a>
            </p>
            <div className="pending-acts">
              <button type="button" className="btn" onClick={recheck} disabled={checking}>{checking ? "Checking…" : "Check again"}</button>
              <button type="button" className="link" onClick={() => { pendingStore.remove(pendingClaim.hash); setSt({ s: "idle" }); }}>
                Forget it: my wallet shows it was dropped
              </button>
            </div>
          </div>
        )}
      </div>
      <h3>How rewards accrue</h3>
      <ul className="bullets">
        <li>A candle earns only from candles bought after it. It never earns from its own purchase.</li>
        <li>The very first candle has no earlier candles, so its 60% reward share is added to the burn allocation (90% burn in total).</li>
        <li>A batch is processed one candle at a time, so earlier candles in your batch earn from later ones in it.</li>
        <li>Example: candle 101 gives each of the 100 earlier candles 0.006 IMD before rounding. A wallet holding three of them receives 0.018 IMD from that purchase.</li>
        <li>Rewards are never sent automatically. They wait in this garden contract until you claim them here, and each claim is its own transaction with gas.</li>
        <li>Rewards go to the wallet that bought the candle. Candles are nontransferable contract records, not NFTs and not a share of treasury assets.</li>
      </ul>
    </section>
  );
}

export function TreasuryPanel() {
  const t = useTreasury();
  const a = useActivity();
  // Try again always starts a new scan; it never repeats a failed request plan inside the old one
  const retry = <button className="link" onClick={() => a.refetch()} disabled={a.isFetching}>{a.isFetching ? "Scanning…" : "Try again"}</button>;
  const e = t.data?.eth;
  const b = t.data?.base;
  const row = (label: string, v: bigint | undefined, note?: string) => (
    <div><dt>{label}{note && <span className="muted"> · {note}</span>}</dt><dd>{v === undefined ? "Unavailable" : `${imd(v)} IMD`}</dd></div>
  );
  /** A failed field read is shown as Unavailable, never as zero. */
  const amt = (v: bigint | undefined) => (v === undefined ? "Unavailable" : `${imd(v)} IMD`);
  const sum = (...vs: (bigint | undefined)[]) => (vs.every((v) => v !== undefined) ? vs.reduce((x, y) => x! + y!, 0n) : undefined);
  const missing = e ? Object.values(e).some((v) => v === undefined) || !b || Object.values(b).some((v) => v === undefined) : false;
  return (
    <section aria-labelledby="treasury-title">
      <h2 id="treasury-title">Treasury</h2>
      <p className="lede">Live reads from the garden contract on Ethereum and the burn receiver on Base. Nothing here is estimated.</p>
      {t.isLoading && <p role="status">Reading the treasury…</p>}
      {t.isError && <p className="bad" role="alert">The treasury could not be read from any RPC. <button className="link" onClick={() => t.refetch()}>Try again</button></p>}
      {e && missing && (
        <p className="bad" role="alert">
          Some figures could not be read and are marked Unavailable. <button className="link" onClick={() => t.refetch()} disabled={t.isFetching}>{t.isFetching ? "Retrying…" : "Try again"}</button>
        </p>
      )}
      {e && (
        <>
          <h3>Payments</h3>
          <dl className="summary">
            <div><dt>Paid candles</dt><dd>{e.totalCandles === undefined ? "Unavailable" : String(e.totalCandles)}</dd></div>
            {row("Total payments", e.totalPayments)}
            {row("IMD held by the garden", e.heldIMD)}
            <div><dt>Sales</dt><dd>{e.activated === undefined || e.purchasesPaused === undefined ? "Unavailable" : e.activated ? (e.purchasesPaused ? "Paused" : "Open") : "Not activated"}</dd></div>
          </dl>
          <h3>Buckets</h3>
          <dl className="summary">
            {row("Operations (5%)", e.operationsBalance)}
            {row("Founder (5%)", e.founderBalance)}
            {row("Withdrawn by owner", sum(e.totalEcosystemWithdrawn, e.totalOperationsWithdrawn, e.totalFounderWithdrawn))}
          </dl>
          <p className="fine">Operations and founder funds are withdrawn by the owner ({addrLink(OWNER)}). They are not owned by candle buyers. This garden has no ecosystem allocation (0%).</p>
          <h3>Rewards (60%)</h3>
          <dl className="summary">
            {row("Allocated to earlier candles", e.totalRewardsAllocated)}
            {row("Claimed", e.totalRewardsClaimed)}
            {row("Owed, not yet claimed", e.rewardLiability)}
          </dl>
          <h3>Burn (30%; 90% for the first-ever candle), stage by stage</h3>
          <ol className="stages">
            <li><strong>Allocated</strong><span>{amt(e.totalBurnAllocated)}</span><em>Set aside on Ethereum by purchases. Not burned yet.</em></li>
            <li><strong>Queued</strong><span>{amt(e.burnQueued)}</span><em>Waiting for the owner to open a burn job. Not burned yet.</em></li>
            <li><strong>Reserved in jobs</strong><span>{amt(e.burnReserved)}</span><em>In {e.burnJobCount === undefined ? "an unknown number of" : String(e.burnJobCount)} burn job(s); {amt(e.failedBurnAmount)} of it failed a send and awaits retry.</em></li>
            <li><strong>Dispatched to Base</strong><span>{amt(e.burnInTransit)}</span><em>Sent across the bridge, not yet acknowledged.</em></li>
            <li><strong>Burned on Base</strong><span>{amt(b?.totalBurned)}</span><em>Base supply reduced. {b ? `${amt(b.pendingBurn)} received and pending burn.` : "The Base RPC did not answer."}</em></li>
            <li><strong>Confirmed on Ethereum</strong><span>{amt(e.confirmedBurn)}</span><em>Base burn receipts acknowledged by the garden.</em></li>
          </ol>
          <p className="fine">A purchase does not burn IMD instantly. Burning crosses chains in owner-started jobs, and this site never sends owner transactions.</p>
        </>
      )}
      <h3>Contracts</h3>
      <ul className="bullets">
        <li>Garden and treasury (Ethereum): {addrLink(GARDEN)}</li>
        <li>IMD (Ethereum): {addrLink(IMD)}</li>
        <li>Burn receiver (Base): {addrLink(BASE_RECEIVER, BASESCAN)}</li>
        <li>IMD (Base): {addrLink(BASE_IMD, BASESCAN)}</li>
        <li>Earlier garden, not used by this site (its own history only; candle numbers are separate): {addrLink(LEGACY_GARDEN)}</li>
        <li><a href={SOURCE_REPO} target="_blank" rel="noreferrer">Contract source at the pinned commit</a></li>
      </ul>
      <h3>Recent activity</h3>
      {a.isLoading && <p role="status">Reading recent events…</p>}
      {a.isError && !a.data && (
        <p className="bad" role="alert">
          Recent activity is unavailable: no RPC host returned these events. The balances above are unaffected. {retry}
        </p>
      )}
      {a.isError && a.data && (
        <p className="stale-note" role="alert">
          Showing activity from the last successful scan, read at {new Date(a.dataUpdatedAt).toLocaleTimeString("en-US")} through block {a.data.head.toString()}. The latest refresh failed, so newer events may be missing. {retry}
        </p>
      )}
      {a.data && (
        <p className="fine">
          {a.data.complete
            ? `Every block from the garden's deployment (${GARDEN_DEPLOY_BLOCK.toString()}) to ${a.data.head.toString()} was read.`
            : `Verified blocks ${a.data.scannedFrom.toString()} to ${a.data.head.toString()} (${a.data.scannedBlocks.toLocaleString("en-US")} blocks).`}
          {a.data.stopped && <> Older events could not be read in this scan ({a.data.stopped.reason === "budget" ? "the request limit for one scan was reached" : "the RPC hosts refused older blocks"}). {!a.isError && retry}</>}
          {!a.data.complete && <> See the <a href={`${ETHERSCAN}/address/${GARDEN}#events`} target="_blank" rel="noreferrer">full event history on Etherscan</a>.</>}
        </p>
      )}
      {a.data && a.data.items.length === 0 && (a.data.complete ? <p>No purchases, claims or burn jobs yet.</p> : <p>No activity in the verified blocks.</p>)}
      {a.data && a.data.items.length > 0 && (
        <ul className="list">
          {a.data.items.map((it) => (
            <li key={it.tx + it.name}>
              <a className="row" href={`${ETHERSCAN}/tx/${it.tx}`} target="_blank" rel="noreferrer">
                <span className="num">{it.block.toString()}</span>
                <span className="grow">{describe(it.name, it.args)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function describe(name: string, a: any): string {
  switch (name) {
    case "CandlesPurchased": return `${short(safeChecksum(a.purchaser))} lit ${a.quantity} candle(s) from #${a.firstCandleId}`;
    case "RewardsClaimed": return `${short(safeChecksum(a.beneficiary))} claimed ${imd(a.amount)} IMD`;
    case "BurnQueued": return `Burn job ${a.jobId} opened for ${imd(a.amount)} IMD`;
    case "BurnDispatched": return `Burn job ${a.jobId} dispatched to Base (${imd(a.amount)} IMD)`;
    case "BurnConfirmed": return `Burn job ${a.jobId} confirmed burned on Base (${imd(a.amount)} IMD)`;
    case "BucketWithdrawn": return `Owner withdrew ${imd(a.amount)} IMD from bucket ${a.bucket}`;
    default: return name;
  }
}

export function HowPanel() {
  return (
    <section aria-labelledby="how-title" className="how">
      <h2 id="how-title">How it works</h2>
      <p className="lede">Everlight Garden is a shared garden of candles on Ethereum. Each candle costs 1 IMD, can carry a public wish, and stays lit in the garden for as long as Ethereum runs.</p>

      <h3>Lighting a candle</h3>
      <ol className="bullets">
        <li>Connect a wallet on Ethereum that holds IMD and a little ETH for gas. Viewing the garden needs no wallet.</li>
        <li>Choose 1 to 50 candles, one of seven styles for each (Purity, Hope, Love, Success, Health, Wealth or Happiness) and an optional wish. Every style costs the same 1 IMD.</li>
        <li>Approve exactly the total in IMD, then confirm the purchase. Each step is a separate Ethereum transaction and costs gas in ETH.</li>
        <li>Your candles light in the next free spots once the receipt confirms. A large batch with long wishes can exceed what one block allows; the site then splits it into several purchases, each with its own confirmation.</li>
      </ol>

      <h3>Wishes are public and permanent</h3>
      <p>A wish is optional. It is written into the contract for anyone to read, and it can never be edited, hidden or deleted. Keep private details out of it. Each wish is at most 280 characters and 1,120 bytes, and it is always shown as plain text.</p>

      <h3>Where each IMD goes</h3>
      <dl className="summary">
        <div><dt>Burn allocation</dt><dd>30%</dd></div>
        <div><dt>Earlier paid candles</dt><dd>60%</dd></div>
        <div><dt>Operations</dt><dd>5%</dd></div>
        <div><dt>Founder</dt><dd>5%</dd></div>
      </dl>
      <p className="fine">There is no ecosystem allocation (0%). The first-ever candle has no earlier candles to share with, so its 60% joins the burn: 90% burn allocation, 5% operations, 5% founder.</p>

      <h3>How rewards work</h3>
      <ul className="bullets">
        <li>Each new candle shares its 0.60 IMD equally among every candle bought before it. Rewards are counted per candle, not per wallet.</li>
        <li>Example: candle 101 gives each of the 100 earlier candles 0.006 IMD before rounding. A wallet with three of those candles receives 0.018 IMD.</li>
        <li>A candle never earns from its own payment, and past rewards are never shared again.</li>
        <li>A batch is processed in order, so the earlier candles in your batch also share in the later ones.</li>
        <li>Rewards come only from new purchases. With no new purchases there are no new rewards. There is no fixed yield and no guaranteed profit.</li>
      </ul>

      <h3>Claiming</h3>
      <p>Rewards are not sent to your wallet automatically. They wait in this garden contract until you open Rewards and claim them, in a transaction you confirm and pay gas for. Rewards from an earlier contract can only be claimed from that contract.</p>

      <h3>Burning, stage by stage</h3>
      <ol className="bullets">
        <li><strong>Allocated</strong>: each purchase sets IMD aside for burning on Ethereum. It is not burned yet.</li>
        <li><strong>Queued</strong>: the owner opens a burn job for the allocated IMD. Still not burned.</li>
        <li><strong>Bridged</strong>: the job sends the IMD across the bridge to the burn receiver on Base.</li>
        <li><strong>Burned on Base</strong>: the receiver burns it and the Base supply goes down. Only this stage is a burn.</li>
        <li><strong>Acknowledged</strong>: a receipt returns to Ethereum and the garden records the burn as confirmed.</li>
      </ol>

      <h3>What the owner does</h3>
      <ul className="bullets">
        <li>The owner ({addrLink(OWNER)}) opens sales or pauses them, starts burn jobs and pays their bridge fees, and withdraws the operations and founder shares.</li>
        <li>Sales open only when the owner activates them. The garden reads this from the contract every time; this site never sends owner transactions.</li>
      </ul>

      <h3>What a candle is</h3>
      <ul className="bullets">
        <li>A permanent record in the garden contract: owner, style, date and wish. It is not an NFT, cannot be transferred, and is not a share of the treasury or its assets.</li>
        <li>The garden map holds 10,000 spots and grows when they fill. That is a layout, not a supply cap. Empty holders stay unlit; only verified purchases light a candle.</li>
        <li>There is no lottery, no free candle and no new token.</li>
      </ul>

      <h3>Contracts</h3>
      <ul className="bullets">
        <li>Garden (Ethereum): {addrLink(GARDEN)}</li>
        <li>Burn receiver (Base): {addrLink(BASE_RECEIVER, BASESCAN)}</li>
        <li>IMD on Ethereum: {addrLink(IMD)}; IMD on Base: {addrLink(BASE_IMD, BASESCAN)}</li>
        <li>Earlier garden, not used by this site: {addrLink(LEGACY_GARDEN)}. Its candle numbers are separate from this garden's.</li>
        <li><a href={SOURCE_REPO} target="_blank" rel="noreferrer">Contract source at the pinned commit</a></li>
      </ul>

      <h3>Questions</h3>
      <div className="faq">
        <details><summary>Is this endorsed by IMD?</summary><p>No. Everlight Garden is an independent project that accepts IMD as payment. Using the token does not mean its issuers support or review this garden.</p></details>
        <details><summary>Is a candle an investment?</summary><p>No. A candle is a record with a wish. It may receive a share of later purchases, but it can also receive nothing more if nobody buys after you.</p></details>
        <details><summary>Can I edit or delete my wish?</summary><p>No. Wishes are stored onchain forever and anyone can read them.</p></details>
        <details><summary>Why is my candle not lit yet?</summary><p>A candle lights only after its purchase receipt is confirmed on Ethereum. If you reload while waiting, the site picks the transaction up again, including a sped-up or replaced one.</p></details>
        <details><summary>What do I pay in total?</summary><p>1 IMD per candle, plus ETH gas for the approval and for each purchase transaction. Claiming rewards also costs gas.</p></details>
      </div>

      <h3>Reading the garden</h3>
      <ul className="bullets">
        <li>Lit candles glow in their own spot. Empty stone holders mark the places the next candles will take.</li>
        <li>Drag or use arrow keys to move, scroll, pinch or press plus and minus to zoom, and use the minimap to jump. Find goes straight to a candle number.</li>
      </ul>
    </section>
  );
}
