import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useSwitchChain } from "wagmi";
import { getAccount, simulateContract, writeContract } from "wagmi/actions";
import type { Hash } from "viem";
import { wishGardenAbi } from "../abi/WishGarden";
import { burnReceiverAbi } from "../abi/EverlightBurnReceiver";
import { BASESCAN, BASE_RECEIVER, ETHERSCAN, GARDEN, LZSCAN, baseClient, config, ethClient } from "../config";
import { FIXTURE } from "../hooks";
import { useBurn, useBurnOps, type BurnView } from "../burnHooks";
import { eth as ethAmt, imd, short } from "../lib/format";
import { ConnectButton } from "../components/ConnectSheet";
import {
  DISPATCH_MIN_GAS, RETRY_MIN_GAS, ZERO32, addOp, authenticateDelivery, compactImd, crossCheck, holdOp, opHeld, settleHash, deliveryLabel, dispatchEligibility, feeProblem, jobLabel, jobPage,
  outcomeOf, parseImd, planQueue, queueEligibility, receiptEligibility, removeOp, retryEligibility,
  type BurnOp, type Delivery, type Job, type OpKind, type Outcome,
} from "../lib/burn";
import { readBaseSnap, readDeliveries, readEthSnap, readHistory, readJobs, readReceiptSent, type TxRef } from "../lib/burnio";

/** Dashboard amount: 6 decimals, plus the exact token units whenever 6 decimals would hide part of it. */
const amt = (v: bigint | undefined) => (v === undefined ? "Unavailable" : `${imd(v, 6)} IMD${imd(v, 18) !== imd(v, 6) ? ` (${v} units)` : ""}`);
const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString("en-US") : "never");
const txLink = (hash: string, base: string) => <a href={`${base}/tx/${hash}`} target="_blank" rel="noreferrer">{short(hash)}</a>;
const PAGE = 10;

/** A wallet request the user refused: nothing was sent. Walks viem's cause chain. */
export function isRejection(e: unknown): boolean {
  for (let c: any = e, i = 0; c && i < 8; c = c.cause, i++) if (c.code === 4001 || c.name === "UserRejectedRequestError") return true;
  return false;
}
const msg = (e: unknown) => ((e as any)?.shortMessage ?? (e as any)?.message ?? "Unknown error").split("\n")[0];

/** Compact footer counters beside the split. Unavailable or stale is said, never shown as zero. */
export function BurnFooter() {
  const b = useBurn();
  const r = b.good;
  const show = (v: bigint | undefined) => (r && v !== undefined ? compactImd(v, imd) : b.loading ? "…" : "Unavailable");
  const label = b.loading ? "Reading" : !r ? "Unavailable" : b.stale ? `Stale · ${time(b.goodAt)}` : `Updated ${time(b.goodAt)}`;
  const ref = useRef<HTMLDivElement>(null);
  // the strip's real height (it wraps differently per width) is what the zoom, map tools and panels keep clear of;
  // the strip itself never reads this value back, so it shrinks again when the viewport widens
  useEffect(() => {
    const strip = ref.current?.parentElement;
    if (!strip || typeof ResizeObserver === "undefined") return;
    const set = () => { const h = strip.getBoundingClientRect().height; if (h > 0) document.documentElement.style.setProperty("--strip-h", `${Math.ceil(h)}px`); };
    const o = new ResizeObserver(set);
    o.observe(strip); set();
    return () => { o.disconnect(); document.documentElement.style.removeProperty("--strip-h"); };
  }, []);
  const units = (v?: bigint) => (r && v !== undefined ? `${v} token units` : undefined);
  return (
    <div className="burn-live" aria-label="Burn totals" ref={ref}>
      <p title={units(r?.burned)}><span className="burn-k">IMD burned</span> <strong>{show(r?.burned)}</strong></p>
      <p title={units(r?.pending)}><span className="burn-k">Pending burn</span> <strong>{show(r?.pending)}</strong></p>
      <div className="burn-acts">
        <button type="button" className="icon-btn burn-refresh" onClick={b.refresh} disabled={b.fetching} aria-label={`Refresh burn totals. ${label}`} title={label}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" /></svg>
        </button>
        <a className="burn-link" href="#/treasury/burn">Burn details</a>
      </div>
      <p className={(b.stale || !r) && !b.loading ? "burn-time warn" : "burn-time"} role="status">
        {label}
        {r?.eth && r.base && (
          <>
            {" · "}<a href={`${ETHERSCAN}/block/${r.eth.block}`} target="_blank" rel="noreferrer" title={`Ethereum block ${r.eth.block}`}>Ethereum block</a>
            {" · "}<a href={`${BASESCAN}/block/${r.base.block}`} target="_blank" rel="noreferrer" title={`Base block ${r.base.block}`}>Base block</a>
          </>
        )}
      </p>
    </div>
  );
}

/** key: every reviewed figure the wallet request depends on (amounts, job, units, fee). A fresh read must match it. */
interface Review { kind: OpKind; target: string; chainId: 1 | 8453; account: string; key: string; lines: [string, string][]; value: bigint; gas: bigint; args: any[]; note?: string }

export function BurnPanel() {
  const b = useBurn();
  const { address, chainId } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [ops, syncOps] = useBurnOps();
  const [page, setPage] = useState(0);
  const [maxIn, setMaxIn] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const r = b.good;
  const e = r?.eth, bs = r?.base;
  const reviewRef = useRef<HTMLHeadingElement>(null);
  // the review appears below the control that opened it: move focus there so it is seen and announced
  useEffect(() => { if (review) reviewRef.current?.focus(); }, [review]);
  const count = e ? Number(e.burnJobCount) : 0;
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const ids = useMemo(() => jobPage(count, page, PAGE), [count, page]);

  const jobs = useQuery({
    queryKey: ["burn-jobs", ids.join(","), e?.block.toString(), FIXTURE],
    enabled: !!e && FIXTURE === null,
    retry: 1,
    queryFn: async () => {
      const js = await readJobs(ethClient as any, ids, e!.block);
      const dv = await readDeliveries(baseClient as any, js).catch(() => new Map());
      return { js, dv };
    },
  });
  const hist = useQuery({
    queryKey: ["burn-history", count, FIXTURE],
    enabled: !!e && !!bs && count > 0 && FIXTURE === null,
    retry: 0,
    staleTime: 5 * 60_000,
    queryFn: () => readHistory(ethClient as any, baseClient as any, e!.block, bs!.block),
  });

  const isOwner = !!address && !!e && address.toLowerCase() === e.owner.toLowerCase();
  const pendingFor = (kind: OpKind, target: string) => ops.find((o) => o.kind === kind && o.target.toLowerCase() === target.toLowerCase());
  const ethBusy = ops.some((o) => o.kind === "queue" || o.kind === "dispatch");

  // ---------- reviews: fresh reads + quote + simulation + gas, shown before any wallet request ----------
  async function fees(c: typeof ethClient | typeof baseClient, gas: bigint) {
    const f = await (c as any).estimateFeesPerGas().catch(() => null);
    const per = f?.maxFeePerGas ?? (await (c as any).getGasPrice());
    return gas * per;
  }
  async function prepare(kind: OpKind, target: string): Promise<Review> {
    const w = { account: getAccount(config).address, chainId: getAccount(config).chainId };
    if (kind === "queue") {
      const es = await readEthSnap(ethClient as any);
      const max = target === "all" ? es.burnQueued : parseImd(target);
      const why = queueEligibility(w, es, max, ethBusy);
      if (why) throw new Error(why);
      const p = planQueue(es.burnQueued, max!);
      const sim = await simulateContract(config, { address: GARDEN, abi: wishGardenAbi, functionName: "queueBurn", args: [max!], account: w.account!, chainId: 1 });
      const est = await ethClient.estimateContractGas({ address: GARDEN, abi: wishGardenAbi, functionName: "queueBurn", args: [max!], account: w.account! });
      const gas = (est * 13n) / 10n, cost = await fees(ethClient, gas);
      return {
        kind, target, chainId: 1, account: w.account!, key: `queue|${max}|${sim.result}|${p.amount}|${p.dust}|${p.remaining}`, value: 0n, gas, args: [max!],
        lines: [
          ["Step", "1 of 2 · Prepare burn batch (queueBurn)"],
          ["New job", `#${sim.result}`],
          ["Amount reserved", `${imd(p.amount, 6)} IMD (${p.amount} units)`],
          ["Rounded off to bridge precision", `${p.dust} units stay unqueued`],
          ["Unqueued after this", `${imd(p.remaining, 6)} IMD (${p.remaining} units)`],
          ["Estimated gas (max)", `${ethAmt(cost)} ETH · ${gas} gas`],
        ],
        note: "Nothing moves to Base in this step. Sending the batch is step 2.",
      };
    }
    if (kind === "dispatch") {
      const es = await readEthSnap(ethClient as any);
      const [job] = await readJobs(ethClient as any, [Number(target)], es.block);
      const why = dispatchEligibility(w, es, job, ops.some((o) => o.kind === "queue" || (o.kind === "dispatch" && o.target === target)));
      if (why) throw new Error(why);
      const fee = await ethClient.readContract({ address: GARDEN, abi: wishGardenAbi, functionName: "quoteBurn", args: [BigInt(target)] });
      const fp = feeProblem(fee);
      if (fp) throw new Error(fp);
      const est = await ethClient.estimateContractGas({ address: GARDEN, abi: wishGardenAbi, functionName: "dispatchBurn", args: [BigInt(target)], value: fee.nativeFee, account: w.account! });
      const gas = (est * 125n) / 100n > DISPATCH_MIN_GAS ? (est * 125n) / 100n : DISPATCH_MIN_GAS;
      const sim = await simulateContract(config, { address: GARDEN, abi: wishGardenAbi, functionName: "dispatchBurn", args: [BigInt(target)], value: fee.nativeFee, gas, account: w.account!, chainId: 1 });
      if (sim.result !== true) throw new Error("The simulation shows the bridge send failing inside the contract (it would be marked Failed and refunded). Nothing was sent.");
      const cost = await fees(ethClient, gas);
      return {
        kind, target, chainId: 1, account: w.account!, key: `dispatch|${target}|${job.amount}|${job.status}|${job.attempts}|${fee.nativeFee}`, value: fee.nativeFee, gas, args: [BigInt(target)],
        lines: [
          ["Step", `2 of 2 · ${job.status === 2 ? "Retry failed send" : "Send batch to Base"} (dispatchBurn)`],
          ["Job", `#${target} · ${imd(job.amount, 6)} IMD · attempt ${job.attempts + 1}`],
          ["Bridge fee (msg.value, quoteBurn)", `${ethAmt(fee.nativeFee)} ETH (${fee.nativeFee} wei)`],
          ["Estimated gas (max)", `${ethAmt(cost)} ETH · limit ${gas} gas`],
          ["Total ETH at most", `${ethAmt(cost + fee.nativeFee)} ETH`],
        ],
        note: "The quote is read again and must match before the wallet is asked.",
      };
    }
    const bsn = await readBaseSnap(baseClient as any);
    const dv = await baseClient.readContract({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "deliveries", args: [target as Hash] });
    const d: Delivery = { jobId: dv[0], amount: dv[1], attempts: Number(dv[2]), status: Number(dv[3]), acknowledged: dv[4] };
    // authenticate: the Ethereum job this delivery names, and Base's jobGuids for it, must carry the same GUID and amount
    if (d.status === 0) throw new Error("No Base delivery is recorded under this GUID.");
    const [ej] = await readJobs(ethClient as any, [Number(d.jobId)]);
    const jg = await baseClient.readContract({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "jobGuids", args: [d.jobId] }) as Hash;
    const auth = authenticateDelivery(target, ej, jg, d);
    if (auth) throw new Error(auth);
    const busyHere = !!pendingFor(kind, target);
    if (kind === "retry") {
      const why = retryEligibility(w, bsn, d, busyHere);
      if (why) throw new Error(why);
      const est = await baseClient.estimateContractGas({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "retryBurn", args: [target as Hash], account: w.account! });
      const gas = (est * 125n) / 100n > RETRY_MIN_GAS ? (est * 125n) / 100n : RETRY_MIN_GAS;
      await simulateContract(config, { address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "retryBurn", args: [target as Hash], gas, account: w.account!, chainId: 8453 });
      const cost = await fees(baseClient, gas);
      return { kind, target, chainId: 8453, account: w.account!, key: `retry|${target}|${d.jobId}|${d.amount}|${d.status}|${d.attempts}`, value: 0n, gas, args: [target], lines: [["Action", "Retry failed burn (retryBurn)"], ["Delivery", `Job #${d.jobId} · ${imd(d.amount, 6)} IMD · attempt ${d.attempts + 1}`], ["Estimated gas (max)", `${ethAmt(cost)} ETH on Base`]], note: "You pay Base gas and receive no tokens or reward." };
    }
    const why = receiptEligibility(w, bsn, d, busyHere);
    if (why) throw new Error(why);
    const fee = await baseClient.readContract({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "quoteReceipt", args: [2, target as Hash] });
    const fp = feeProblem(fee);
    if (fp) throw new Error(fp);
    const est = await baseClient.estimateContractGas({ address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "sendBurnReceipt", args: [target as Hash], value: fee.nativeFee, account: w.account! });
    const gas = (est * 13n) / 10n;
    await simulateContract(config, { address: BASE_RECEIVER, abi: burnReceiverAbi, functionName: "sendBurnReceipt", args: [target as Hash], value: fee.nativeFee, gas, account: w.account!, chainId: 8453 });
    const cost = await fees(baseClient, gas);
    return { kind, target, chainId: 8453, account: w.account!, key: `receipt|${target}|${d.jobId}|${d.amount}|${d.status}|${d.acknowledged}|${fee.nativeFee}`, value: fee.nativeFee, gas, args: [target], lines: [["Action", "Send burn confirmation to Ethereum (sendBurnReceipt)"], ["Delivery", `Job #${d.jobId} · ${imd(d.amount, 6)} IMD`], ["Message fee (quoteReceipt)", `${ethAmt(fee.nativeFee)} ETH`], ["Estimated gas (max)", `${ethAmt(cost)} ETH on Base`], ["Total ETH at most", `${ethAmt(cost + fee.nativeFee)} ETH`]], note: "You pay gas and the message fee and receive no tokens or reward. It can be sent only once." };
  }

  const startReview = async (kind: OpKind, target: string) => {
    setResult(null); setReview(null); setBusy(`${kind}:${target}`);
    try { setReview(await prepare(kind, target)); } catch (x) { setResult({ ok: false, text: `Not ready: ${msg(x)}` }); } finally { setBusy(null); }
  };

  // ---------- send: re-validate, re-quote, re-simulate, then ask the wallet once ----------
  const confirm = async () => {
    if (!review) return;
    setBusy("send"); setResult(null);
    let op: BurnOp | null = null;
    try {
      const fresh = await prepare(review.kind, review.target);
      if (fresh.key !== review.key || fresh.account.toLowerCase() !== review.account.toLowerCase()) {
        setReview(fresh);
        throw new Error("The figures changed since your review (amount, job, units, account or fee). Check the new review and confirm again. Nothing was sent.");
      }
      const a = getAccount(config);
      if (a.address?.toLowerCase() !== review.account.toLowerCase()) throw new Error("The connected account changed since your review. Nothing was sent.");
      if (a.chainId !== review.chainId) throw new Error(`Your wallet is no longer on ${review.chainId === 1 ? "Ethereum" : "Base"}.`);
      const address = review.chainId === 1 ? GARDEN : BASE_RECEIVER;
      const abi: any = review.chainId === 1 ? wishGardenAbi : burnReceiverAbi;
      const functionName = { queue: "queueBurn", dispatch: "dispatchBurn", retry: "retryBurn", receipt: "sendBurnReceipt" }[review.kind];
      const { request, result: simResult } = await simulateContract(config, { address, abi, functionName, args: fresh.args, value: fresh.value || undefined, gas: fresh.gas, account: a.address!, chainId: review.chainId } as any);
      // dispatchBurn returns false when it catches a failed bridge send: that is not a success, so the wallet is not asked
      if (review.kind === "dispatch" && simResult !== true) throw new Error("The final simulation shows the bridge send failing inside the contract (it would be marked Failed and refunded). Nothing was sent; the job stays retryable.");
      if (review.kind === "queue" && String(simResult) !== review.key.split("|")[2]) { setReview(fresh); throw new Error("The next job number changed since your review. Check the new review and confirm again. Nothing was sent."); }
      op = { id: crypto.randomUUID?.() ?? String(Date.now()), kind: review.kind, chainId: review.chainId, account: a.address!, target: review.target, value: String(fresh.value), stage: "signing", createdAt: Date.now() };
      if (!(await addOp(op))) { op = null; throw new Error("This operation is already pending in this or another tab."); }
      syncOps();
      // keep this operation locked across tabs while the wallet request is open, so no tab can forget it meanwhile
      const pending = writeContract(config, { ...(request as any), account: a.address!, chainId: review.chainId });
      await holdOp(op.id, pending);
      let hash: Hash;
      try {
        hash = await pending;
      } catch (x) {
        if (isRejection(x)) { await removeOp(op.id); syncOps(); op = null; throw new Error("You rejected the request in your wallet. Nothing was sent."); }
        throw new Error(`The wallet did not return a transaction hash (${msg(x)}). It may still have sent one: check your wallet's activity before trying again. The operation stays saved below.`);
      }
      // a returned hash is always kept, even if the record was forgotten meanwhile
      const sent = await settleHash(op, hash); syncOps();
      setReview(null);
      await follow(sent);
    } catch (x) {
      setResult({ ok: false, text: msg(x) });
    } finally { setBusy(null); }
  };

  /**
   * Follow a sent operation to its mined receipt (replacements included) and judge it by its events. viem's public
   * client returns a reverted receipt (wagmi's action throws on one), so a mined revert is reported and unlocks retry.
   */
  async function follow(op: BurnOp) {
    let replaced = "";
    const client: any = op.chainId === 1 ? ethClient : baseClient;
    const rec = await client.waitForTransactionReceipt({ hash: op.hash!, timeout: 15 * 60_000, onReplaced: (x: { reason: string }) => { replaced = x.reason; } }).catch(() => null);
    if (!rec) { setResult({ ok: false, text: "No receipt yet. The operation stays saved; check again later.", href: `${op.chainId === 1 ? ETHERSCAN : BASESCAN}/tx/${op.hash}` }); return; }
    const out: Outcome = outcomeOf(op.kind, op.target, rec as any, GARDEN, BASE_RECEIVER);
    await removeOp(op.id); syncOps();
    setResult({ ok: out.ok, text: `${replaced ? `Your wallet ${replaced} the transaction. ` : ""}${out.text}`, href: `${op.chainId === 1 ? ETHERSCAN : BASESCAN}/tx/${rec.transactionHash}` });
    b.refresh(); jobs.refetch();
  }

  // reload recovery: follow saved hashes (never re-send); operations without a hash are shown as uncertain
  useEffect(() => {
    ops.filter((o) => o.stage === "sent" && o.hash).forEach((o) => { follow(o); });
  }, []);

  const wrong = (want: 1 | 8453) => address && chainId !== want && (
    <button type="button" className="btn" disabled={switching} onClick={() => switchChain({ chainId: want })}>{switching ? "Confirm in your wallet…" : `Switch to ${want === 1 ? "Ethereum" : "Base"}`}</button>
  );
  const qMax = maxIn.trim() === "" ? null : parseImd(maxIn);
  const qPlan = e && qMax !== null ? planQueue(e.burnQueued, qMax) : null;
  const queueWhy = queueEligibility({ account: address, chainId }, e, qMax, ethBusy);

  return (
    <section aria-labelledby="burn-title" className="burn">
      <p className="crumbs"><a href="#/treasury">Treasury</a> / Burn</p>
      <h2 id="burn-title">Burn dashboard</h2>
      <p className="lede">Track IMD allocated on Ethereum and burned on Base. The first candle allocates 90% to burn. Later candles allocate 30%.</p>
      <Snapshot b={b} />

      <h3>Totals</h3>
      <dl className="summary">
        <div><dt>IMD burned (Base totalBurned)</dt><dd>{amt(r?.burned)}</dd></div>
        <div><dt>Pending burn (allocated − burned)</dt><dd>{amt(r?.pending)}</dd></div>
      </dl>

      <h3>Ethereum garden</h3>
      <ol className="stages">
        <li><strong>Allocated to burn</strong><span>{amt(e?.totalBurnAllocated)}</span><em>totalBurnAllocated: every burn share ever set aside by purchases.</em></li>
        <li><strong>Unqueued</strong><span>{amt(e?.burnQueued)}</span><em>burnQueued: not in a job yet. {e ? `${e.bridgeDust} units are below bridge precision (0.000001 IMD).` : ""}</em></li>
        <li><strong>Reserved in jobs</strong><span>{amt(e?.burnReserved)}</span><em>burnReserved: in jobs not yet sent. Includes {amt(e?.failedBurnAmount)} whose send failed; that is part of this figure, not extra.</em></li>
        <li><strong>Dispatched, unacknowledged</strong><span>{amt(e?.burnInTransit)}</span><em>burnInTransit: sent to Base, no confirmation back yet. Some of it can already be burned: {amt(r?.unacknowledgedBurned)} burned on Base and not yet confirmed here.</em></li>
        <li><strong>Confirmed burned</strong><span>{amt(e?.confirmedBurn)}</span><em>confirmedBurn: Base burns acknowledged on Ethereum. The same tokens as part of Base totalBurned, never added to it.</em></li>
      </ol>
      <h3>Base receiver</h3>
      <ol className="stages">
        <li><strong>Received</strong><span>{amt(bs?.totalReceived)}</span><em>Delivered by the bridge.</em></li>
        <li><strong>Pending burn on Base</strong><span>{amt(bs?.pendingBurn)}</span><em>Received, not burned. Includes {amt(bs?.failedBurn)} whose burn attempt failed. It can overlap Ethereum's in-transit figure, so the two are never summed.</em></li>
        <li><strong>Burned</strong><span>{amt(bs?.totalBurned)}</span><em>totalBurned: Base supply actually reduced. This is the footer's IMD burned.</em></li>
      </ol>

      <h3>Burn jobs</h3>
      <p className="fine">{e ? `${count} job${count === 1 ? "" : "s"} created in all (burnJobCount is a historical count, not pending jobs).` : "Job count unavailable."} Read from the burnJobs mapping at the snapshot block, newest first.</p>
      {count === 0 && e && <p>No burn job has been created yet.</p>}
      {jobs.isError && <p className="bad" role="alert">Jobs could not be read. <button className="link" onClick={() => jobs.refetch()}>Try again</button></p>}
      {jobs.data && (
        <ul className="jobs">
          {jobs.data.js.map((j) => <JobRow key={j.id} j={j} side={jobs.data!.dv.get(j.id)} hist={hist.data} start={startReview} busy={busy} isOwner={isOwner} chainId={chainId} address={address} pendingFor={pendingFor} ethBusy={ethBusy} />)}
        </ul>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Burn job pages">
          <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button>
          <span>Page {page + 1} of {pages}</span>
          <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Older</button>
        </nav>
      )}
      {hist.data && !hist.data.complete && <p className="stale-note">{hist.data.note}</p>}
      {hist.isError && <p className="stale-note">Transaction links are unavailable (event history could not be read). Job states are unaffected.</p>}

      <h3>Owner actions (Ethereum)</h3>
      {!address ? (
        <div className="owner-off"><p className="fine">Only the garden's onchain owner{e ? ` (${short(e.owner)}, read from owner())` : ""} can prepare and send burn batches.</p><ConnectButton label="Connect wallet" /></div>
      ) : !isOwner ? (
        <p className="fine">Connected {short(address)} is not the onchain owner{e ? ` (${short(e.owner)})` : ""}. Owner actions stay off.</p>
      ) : (
        <div className="owner">
          <label htmlFor="qmax">Maximum to queue (IMD)</label>
          <div className="row-in">
            <input id="qmax" inputMode="decimal" value={maxIn} onChange={(x) => setMaxIn(x.target.value)} placeholder={e ? imd(e.burnQueued, 18) : "0"} aria-describedby="qmax-note" />
            <button type="button" className="btn" onClick={() => e && setMaxIn(imd(e.burnQueued, 18).replace(/,/g, ""))}>All unqueued</button>
          </div>
          <p id="qmax-note" className="fine">{qPlan ? `Queues ${imd(qPlan.amount, 6)} IMD; ${qPlan.dust} units are rounded off and stay unqueued with the rest (${imd(qPlan.remaining, 6)} IMD).` : maxIn && qMax === null ? "Enter a number such as 5.4." : "Amounts are rounded down to 0.000001 IMD, the bridge's precision."}</p>
          <button type="button" className="cta" disabled={!!queueWhy || busy !== null} onClick={() => startReview("queue", maxIn.trim())}>Prepare burn batch</button>
          {queueWhy && <p className="fine">{queueWhy}</p>}
          {wrong(1)}
        </div>
      )}

      {review && (
        <div className="review" role="region" aria-label="Review before your wallet">
          <h3 ref={reviewRef} tabIndex={-1}>Review before your wallet</h3>
          <dl className="summary">{review.lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {review.note && <p className="fine">{review.note}</p>}
          <div className="row-in">
            <button type="button" className="cta" disabled={busy !== null} onClick={confirm}>{busy === "send" ? "Confirm in your wallet…" : "Confirm in wallet"}</button>
            <button type="button" className="btn" disabled={busy === "send"} onClick={() => setReview(null)}>Cancel</button>
          </div>
        </div>
      )}
      {result && <p className={result.ok ? "ok-note" : "bad"} role="alert">{result.text} {result.href && <a href={result.href} target="_blank" rel="noreferrer">View transaction</a>}</p>}
      <SavedOps ops={ops} onForget={async (id) => {
        // a tab still waiting on the wallet for this operation holds its lock: refuse, so its hash cannot be lost
        if (busy === "send" || (await opHeld(id))) { setResult({ ok: false, text: "A tab is still waiting on your wallet for this operation. Finish or reject it in the wallet first." }); return; }
        await removeOp(id); syncOps();
      }} onCheck={(o) => { if (o.hash) follow(o); else { b.refresh(); jobs.refetch(); } }} />

      <h3>Public actions (Base)</h3>
      <p className="fine">Base normally burns a delivery automatically when it arrives. If that attempt failed, anyone can retry it; after a burn, anyone can send the confirmation back to Ethereum. The caller pays gas (and the message fee for a confirmation) and receives no tokens or reward. The receiver's internal burn function only runs from the receiver itself, so this site never offers it. These buttons appear on the matching job above.</p>
      {address && chainId !== 8453 && jobs.data?.dv && [...jobs.data.dv.values()].some((s) => s.delivery && (s.delivery.status === 2 || (s.delivery.status === 3 && !s.delivery.acknowledged))) && wrong(8453)}

      <h3>Explorers</h3>
      <ul className="bullets">
        <li>Garden: <a href={`${ETHERSCAN}/address/${GARDEN}`} target="_blank" rel="noreferrer">{short(GARDEN)} on Etherscan</a></li>
        <li>Burn receiver: <a href={`${BASESCAN}/address/${BASE_RECEIVER}`} target="_blank" rel="noreferrer">{short(BASE_RECEIVER)} on Basescan</a></li>
        <li>Bridge messages: <a href={`${LZSCAN}/address/${GARDEN}`} target="_blank" rel="noreferrer">garden on LayerZero Scan</a></li>
      </ul>
    </section>
  );
}

function Snapshot({ b }: { b: BurnView }) {
  const r = b.good, n = b.now;
  return (
    <div className="snap" role="status">
      {b.loading && <p>Reading both chains…</p>}
      {r && (
        <p className="fine">
          Ethereum block <a href={`${ETHERSCAN}/block/${r.eth!.block}`} target="_blank" rel="noreferrer">{String(r.eth!.block)}</a> ({time(r.eth!.ts * 1000)}) · Base block <a href={`${BASESCAN}/block/${r.base!.block}`} target="_blank" rel="noreferrer">{String(r.base!.block)}</a> ({time(r.base!.ts * 1000)}) · Last update {time(b.goodAt)} · refreshes every minute.{" "}
          <button className="link" onClick={b.refresh} disabled={b.fetching}>{b.fetching ? "Refreshing…" : "Refresh"}</button>
        </p>
      )}
      {n && n.health !== "ok" && (
        <p className="stale-note">
          {n.health === "unavailable" ? "Neither chain answered." : n.health === "partial" ? "Only one chain answered." : "The two chains' reads did not agree"} after {n.attempts} attempt{n.attempts === 1 ? "" : "s"}{n.issues.length ? `: ${n.issues.join(" ")}` : "."}{" "}
          {r ? `Showing the last consistent snapshot from ${time(b.goodAt)} (stale).` : "Figures stay Unavailable until both chains agree."}{" "}
          {!r && <button className="link" onClick={b.refresh} disabled={b.fetching}>Try again</button>}
        </p>
      )}
      {r && b.stale && n?.health === "ok" && <p className="stale-note">These reads are older than three minutes (stale).</p>}
    </div>
  );
}

function JobRow({ j, side, hist, start, busy, isOwner, chainId, address, pendingFor, ethBusy }: {
  j: Job; side?: { jobGuid?: Hash; delivery?: Delivery | null }; hist?: { eth: Map<number, TxRef[]>; base: Map<string, TxRef[]> };
  start: (k: OpKind, t: string) => void; busy: string | null; isOwner: boolean; chainId?: number; address?: string;
  pendingFor: (k: OpKind, t: string) => BurnOp | undefined; ethBusy: boolean;
}) {
  const cc = crossCheck(j, side?.jobGuid, side?.delivery);
  const d = side?.delivery;
  const et = hist?.eth.get(j.id) ?? [];
  const bt = j.guid !== ZERO32 ? hist?.base.get(j.guid.toLowerCase()) ?? [] : [];
  const dispatchTx = et.filter((t) => t.name === "BurnDispatched" && t.detail?.toLowerCase() === j.guid.toLowerCase()).pop();
  // a pending confirmation: look up its ReceiptSent by the indexed burn GUID, newest blocks first
  const wantReceipt = !!d?.acknowledged && j.status === 3 && j.guid !== ZERO32;
  const rq = useQuery({
    queryKey: ["burn-receipt", j.guid],
    enabled: wantReceipt && FIXTURE === null,
    retry: 0,
    staleTime: 5 * 60_000,
    queryFn: () => readReceiptSent(baseClient as any, j.guid),
  });
  const receiptTx = rq.data?.tx ?? bt.find((t) => t.name === "ReceiptSent");
  const canDispatch = isOwner && (j.status === 1 || j.status === 2);
  const w = { account: address, chainId };
  // public actions only for an authenticated delivery: Ethereum job, Base jobGuids and deliveries agree
  const auth = j.guid === ZERO32 ? "Not sent yet." : authenticateDelivery(j.guid, j, side?.jobGuid, d);
  const retryWhy = auth ?? retryEligibility(w, { activated: true } as any, d, !!pendingFor("retry", j.guid));
  const rcWhy = auth ?? receiptEligibility(w, { activated: true } as any, d, !!pendingFor("receipt", j.guid));
  return (
    <li className="job">
      <div className="job-h"><strong>Job #{j.id}</strong><span>{imd(j.amount, 6)} IMD</span></div>
      <dl className="job-d">
        <div><dt>Ethereum</dt><dd>{jobLabel(j.status)} · {j.attempts} send attempt{j.attempts === 1 ? "" : "s"}</dd></div>
        <div><dt>Base</dt><dd>{j.guid === ZERO32 ? "Not sent" : deliveryLabel(d)}{d && d.status ? ` · ${d.attempts} burn attempt${d.attempts === 1 ? "" : "s"}` : ""}</dd></div>
        <div><dt>GUID</dt><dd className="mono">{j.guid === ZERO32 ? "none yet" : dispatchTx ? <a href={`${LZSCAN}/tx/${dispatchTx.hash}`} target="_blank" rel="noreferrer">{j.guid}</a> : j.guid}</dd></div>
        <div><dt>Check</dt><dd className={cc.ok ? "" : "bad"}>{cc.note}</dd></div>
        <div><dt>Transactions</dt><dd>
          {et.length + bt.length === 0 ? "Not located in the scanned history" : null}
          {et.map((t) => <span key={t.hash + t.name}>{t.name} {txLink(t.hash, ETHERSCAN)} </span>)}
          {bt.map((t) => <span key={t.hash + t.name}>{t.name} {txLink(t.hash, BASESCAN)} </span>)}
        </dd></div>
      </dl>
      {d?.acknowledged && j.status === 3 && (
        <p className="stale-note">Confirmation sent from Base, not yet delivered to Ethereum. It is retried on LayerZero with the same message; tokens are never resent or burned again. {receiptTx ? (
            <>
              <a href={`${LZSCAN}/tx/${receiptTx.hash}`} target="_blank" rel="noreferrer">Message status on LayerZero Scan</a>{" · "}
              <a href={`${BASESCAN}/tx/${receiptTx.hash}`} target="_blank" rel="noreferrer">ReceiptSent on Basescan</a>
              {receiptTx.detail && <span className="mono"> · message GUID {receiptTx.detail}</span>}
            </>
          ) : rq.isFetching ? "Looking up the confirmation message…" : (
            <>
              {rq.data ? `ReceiptSent for this GUID was not found in Base blocks ${rq.data.from}–${rq.data.to}${rq.data.complete ? "" : " (partial: the RPC limited the search)"}.` : rq.isError ? "The confirmation message could not be looked up." : ""}{" "}
              <a href={`${LZSCAN}/address/${BASE_RECEIVER}`} target="_blank" rel="noreferrer">Receiver on LayerZero Scan</a>
            </>
          )}</p>
      )}
      <div className="job-a">
        {canDispatch && (
          <button type="button" className="cta" disabled={busy !== null || ethBusy || chainId !== 1} onClick={() => start("dispatch", String(j.id))}>
            {j.status === 2 ? "Retry failed send" : "Send batch to Base"}
          </button>
        )}
        {d?.status === 2 && <button type="button" className="btn" disabled={busy !== null || !!retryWhy} onClick={() => start("retry", j.guid)} title={retryWhy ?? undefined}>Retry failed burn</button>}
        {d?.status === 3 && !d.acknowledged && <button type="button" className="btn" disabled={busy !== null || !!rcWhy} onClick={() => start("receipt", j.guid)} title={rcWhy ?? undefined}>Send burn confirmation to Ethereum</button>}
        {(d?.status === 2 || (d?.status === 3 && !d.acknowledged)) && (retryWhy ?? rcWhy) && <span className="fine">{d.status === 2 ? retryWhy : rcWhy}</span>}
        {canDispatch && chainId !== 1 && <span className="fine">Switch to Ethereum to send.</span>}
      </div>
    </li>
  );
}

function SavedOps({ ops, onForget, onCheck }: { ops: BurnOp[]; onForget: (id: string) => void; onCheck: (o: BurnOp) => void }) {
  if (!ops.length) return null;
  const name = { queue: "Prepare burn batch", dispatch: "Send batch", retry: "Retry burn", receipt: "Burn confirmation" };
  return (
    <div className="saved" role="region" aria-label="Saved burn operations">
      <h3>Saved operations</h3>
      <ul className="bullets">
        {ops.map((o) => (
          <li key={o.id}>
            {name[o.kind]} {o.kind === "queue" ? "" : o.kind === "dispatch" ? `#${o.target}` : short(o.target)} · {new Date(o.createdAt).toLocaleString("en-US")} ·{" "}
            {o.hash ? <>sent {txLink(o.hash, o.chainId === 1 ? ETHERSCAN : BASESCAN)}, waiting for its receipt</> : "the wallet was asked but no hash came back; the outcome is uncertain. Check your wallet's activity."}{" "}
            <button className="link" onClick={() => onCheck(o)}>Check again</button>{" "}
            {!o.hash && <button className="link" onClick={() => onForget(o.id)}>I checked my wallet: forget it</button>}
          </li>
        ))}
      </ul>
      <p className="fine">Nothing here is ever sent again automatically.</p>
    </div>
  );
}

