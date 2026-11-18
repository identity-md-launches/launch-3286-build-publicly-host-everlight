import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { wishGardenAbi } from "../abi/WishGarden";
import { BASESCAN, BASE_IMD, BASE_RECEIVER, ETHERSCAN, GARDEN, IMD, OWNER, SOURCE_REPO, config } from "../config";
import { STYLE_NAMES, date, imd, short, safeChecksum } from "../lib/format";
import { explainError } from "../lib/errors";
import { pendingStore } from "../lib/purchase";
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
      <div className="detail-body">
        <img src={`./art/candle-${c.style}.svg`} alt="" width={40} height={80} />
        <dl className="kv">
          <div><dt>Owner</dt><dd>{FIXTURE === null ? addrLink(c.purchaser) : short(c.purchaser)}{mine ? " (you)" : ""}</dd></div>
          <div><dt>Style</dt><dd>{STYLE_NAMES[c.style] ?? `Style ${c.style}`}</dd></div>
          <div><dt>Lit</dt><dd>{date(c.createdAt)}</dd></div>
          <div><dt>Position</dt><dd>{c.position}</dd></div>
          <div><dt>Transaction</dt><dd><TxCell c={c} /></dd></div>
        </dl>
      </div>
      {c.wish ? <blockquote className="wish">{c.wish}</blockquote> : <p className="muted">No wish was written for this candle.</p>}
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
export function Register({ candles, onJump }: { candles: Candle[]; onJump: (id: number) => void }) {
  const [page, setPage] = useState(0);
  const per = 25;
  const pages = Math.max(1, Math.ceil(candles.length / per));
  const shown = candles.slice(page * per, page * per + per);
  return (
    <section aria-labelledby="reg-title">
      <h2 id="reg-title">Candle register</h2>
      {candles.length === 0 ? (
        <p>No candle has been lit yet. Every holder in the garden is empty and waiting.</p>
      ) : (
        <>
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

type ClaimState = { s: "idle" } | { s: "wallet" } | { s: "pending"; hash: string } | { s: "done"; hash: string } | { s: "error"; msg: string };

export function RewardsPanel() {
  const { address, chainId } = useAccount();
  const r = useRewards(address);
  const qc = useQueryClient();
  const [st, setSt] = useState<ClaimState>({ s: "idle" });
  const busy = useRef(false);
  async function claim() {
    if (busy.current || !address) return;
    busy.current = true;
    try {
      setSt({ s: "wallet" });
      const { request } = await simulateContract(config, { address: GARDEN, abi: wishGardenAbi, functionName: "claimRewards", account: address, chainId: 1 });
      const hash = await writeContract(config, request);
      pendingStore.add({ hash, kind: "claim", account: address, createdAt: Date.now() });
      setSt({ s: "pending", hash });
      const rec = await waitForTransactionReceipt(config, { hash, chainId: 1 });
      pendingStore.remove(hash);
      setSt(rec.status === "success" ? { s: "done", hash } : { s: "error", msg: "The claim reverted onchain. Only gas was spent." });
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
      <p className="lede">30% of every later candle is shared equally among all earlier candles, per candle rather than per wallet. Rewards depend entirely on later purchases: there is no guaranteed return and no fixed APY.</p>
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
        <button className="cta wide" onClick={claim} disabled={d.claimable === 0n || chainId !== 1 || st.s === "wallet" || st.s === "pending"}>
          {st.s === "wallet" ? "Confirm in your wallet…" : st.s === "pending" ? "Claiming…" : d.claimable === 0n ? "Nothing to claim yet" : `Claim ${imd(d.claimable)} IMD`}
        </button>
      )}
      {address && chainId !== 1 && <p className="bad">Switch your wallet to Ethereum to claim.</p>}
      <div aria-live="polite" className="steps">
        {st.s === "pending" && <p>Claim sent. Waiting for its receipt… <a href={`${ETHERSCAN}/tx/${st.hash}`} target="_blank" rel="noreferrer">View transaction</a></p>}
        {st.s === "done" && <p>Claimed. <a href={`${ETHERSCAN}/tx/${st.hash}`} target="_blank" rel="noreferrer">View transaction</a></p>}
        {st.s === "error" && <p className="bad" role="alert">{st.msg}</p>}
      </div>
      <h3>How rewards accrue</h3>
      <ul className="bullets">
        <li>A candle earns only from candles bought after it. It never earns from its own purchase.</li>
        <li>The very first candle has no earlier candles, so its reward share goes to the ecosystem bucket.</li>
        <li>A batch is processed one candle at a time, so earlier candles in your batch earn from later ones in it.</li>
        <li>Rewards are paid in IMD to the wallet that bought the candle. Candles are nontransferable records, not NFTs.</li>
      </ul>
    </section>
  );
}

export function TreasuryPanel() {
  const t = useTreasury();
  const a = useActivity();
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
            {row("Ecosystem (30%)", e.ecosystemBalance, "owner-managed")}
            {row("Operations (5%)", e.operationsBalance)}
            {row("Founder (5%)", e.founderBalance)}
            {row("Withdrawn by owner", sum(e.totalEcosystemWithdrawn, e.totalOperationsWithdrawn, e.totalFounderWithdrawn))}
          </dl>
          <p className="fine">Ecosystem funds are managed by the owner ({addrLink(OWNER)}). They are not owned by candle buyers.</p>
          <h3>Rewards (30%)</h3>
          <dl className="summary">
            {row("Allocated to earlier candles", e.totalRewardsAllocated)}
            {row("Claimed", e.totalRewardsClaimed)}
            {row("Owed, not yet claimed", e.rewardLiability)}
          </dl>
          <h3>Burn (30%), stage by stage</h3>
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
        <li><a href={SOURCE_REPO} target="_blank" rel="noreferrer">Contract source at the pinned commit</a></li>
      </ul>
      <h3>Recent activity</h3>
      {a.isLoading && <p role="status">Reading recent events…</p>}
      {a.isError && <p className="bad">Recent events could not be read. The balances above are unaffected.</p>}
      {a.data && a.data.items.length === 0 && <p>No purchases, claims or burn jobs yet.</p>}
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
    <section aria-labelledby="how-title">
      <h2 id="how-title">How it works</h2>
      <ol className="bullets">
        <li>Connect a wallet on Ethereum that holds IMD and a little ETH for gas. Viewing the garden needs no wallet.</li>
        <li>Choose 1 to 50 candles, a style for each and an optional wish. Every style costs the same 1 IMD.</li>
        <li>Approve exactly the total, then confirm the purchase. Your candles light in the next free positions once the receipt confirms.</li>
      </ol>
      <h3>Where each IMD goes</h3>
      <dl className="summary">
        <div><dt>Burn allocation</dt><dd>30%</dd></div>
        <div><dt>Earlier candles</dt><dd>30%</dd></div>
        <div><dt>Ecosystem</dt><dd>30%</dd></div>
        <div><dt>Operations</dt><dd>5%</dd></div>
        <div><dt>Founder</dt><dd>5%</dd></div>
      </dl>
      <h3>What a candle is</h3>
      <ul className="bullets">
        <li>A permanent, nontransferable record on Ethereum: owner, style, date and wish. It is not an NFT and never expires.</li>
        <li>There is no supply cap, no lottery and no free candle. Every light in the garden was paid for.</li>
        <li>Wishes are public and immutable, up to 280 characters and 1120 bytes. They are shown as plain text.</li>
        <li>Rewards come only from later purchases. There is no promised return.</li>
      </ul>
      <h3>Reading the garden</h3>
      <ul className="bullets">
        <li>Lit candles glow in their own spot. Empty stone holders mark the places the next candles will take.</li>
        <li>Drag or use arrow keys to move, scroll, pinch or press plus and minus to zoom, and use the minimap to jump.</li>
      </ul>
    </section>
  );
}
