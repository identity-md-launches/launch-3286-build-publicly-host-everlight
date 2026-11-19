import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { erc20Abi, type Hash } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { wishGardenAbi } from "../abi/WishGarden";
import { ETHERSCAN, GARDEN, IMD, MAX_BATCH, TX_GAS_CAP, config, ethClient } from "../config";
import { checkWish, gasBound } from "../lib/wish";
import { STYLE_NAMES, eth, imd } from "../lib/format";
import { explainError } from "../lib/errors";
import { FIXTURE_MESSAGE, awaitBuy, isRunning, pendingStore, purchaseFlow, runPurchase, type PendingTx, type Step } from "../lib/purchase";
import { readReceipt } from "../lib/receipt";
import { minedTx, NONCE_UNVERIFIED, sentTx, settleBuyReceipt, submissionMeta } from "../lib/chain";
import { rememberTx } from "../lib/txhash";
import { parseQuantity } from "../lib/quantity";
import { ConnectButton } from "../components/ConnectSheet";
import { WrongNetwork } from "../components/WrongNetwork";

import { FIXTURE, store, useGasPrice, useStatus, useWallet } from "../hooks";

export const DRAFT_KEY = "everlight:draft";
/** A confirmed purchase ends the saved draft, even when it confirms while this panel is closed. */
export function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
}
/** One purchase at a time across remounts of this panel: a second click or a reopened form cannot send twice. */
let inFlight = false;

/** Recover a purchase sent before a reload: the form stays locked on it until its receipt settles. */
export function recoverBuy(tx: PendingTx): Promise<Step> {
  const onStep = (s: Step) => {
    if (s.name === "done") clearDraft();
    purchaseFlow.set(s);
  };
  onStep({ name: "buy-pending", hash: tx.hash });
  return awaitBuy(
    {
      // locates a replacement from the saved sender, nonce and submission block, then verifies its calldata and events
      wait: (hash, saved) => settleBuyReceipt(hash, saved),
      remember: rememberTx,
      explain: (e) => e instanceof Error && e.message === NONCE_UNVERIFIED
        ? NONCE_UNVERIFIED
        : "The receipt of the purchase you sent could not be read yet. It is still saved and this form stays locked so it is not sent twice.",
    },
    tx,
    onStep,
  );
}

const ART = (i: number) => `./art/px/candle-${i}.png`;

export function StylePicker({ value, onChange, name }: { value: number; onChange: (v: number) => void; name: string }) {
  return (
    <div className="styles" role="radiogroup" aria-label="Candle style">
      {STYLE_NAMES.map((n, i) => (
        <label key={i} className={`style-opt${value === i ? " on" : ""}`}>
          <input type="radio" name={name} value={i} checked={value === i} onChange={() => onChange(i)} />
          <img className="px" src={ART(i)} alt="" width={20} height={32} />
          <span>{n}</span>
        </label>
      ))}
    </div>
  );
}

function WishField({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  const c = checkWish(value);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder="May this garden keep our light" aria-describedby={`${id}-count`} aria-invalid={!c.ok} />
      <span id={`${id}-count`} className={`count${c.ok ? "" : " bad"}`}>
        {c.codepoints}/280 characters · {c.bytes}/1120 bytes{c.error ? `. ${c.error}` : ""}
      </span>
    </div>
  );
}

const STEP_TEXT: Record<Step["name"], string> = {
  checking: "Checking sales status, balance and approval…",
  "approve-wallet": "Confirm the exact IMD approval in your wallet.",
  "approve-pending": "Approval sent. Waiting for its receipt…",
  simulating: "Checking the purchase against the contract…",
  "buy-wallet": "Confirm the purchase in your wallet.",
  "buy-pending": "Purchase sent. Waiting for its receipt; this draft stays locked until it settles…",
  "buy-unknown": "",
  done: "Your candles are lit.",
  error: "",
};

export function LightPanel({ onLit }: { onLit: (firstId: number | null, quantity: number) => void }) {
  const { address, chainId, isConnected } = useAccount();
  const status = useStatus();
  const wallet = useWallet(address);
  const gas = useGasPrice();
  const qc = useQueryClient();
  // the draft survives wallet and network errors, reloads and route changes (session only)
  const draft = useMemo(() => { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}"); } catch { return {}; } }, []);
  const [preset, setPreset] = useState<number>(typeof draft.preset === "number" ? draft.preset : 1);
  const [custom, setCustom] = useState<string>(typeof draft.custom === "string" ? draft.custom : "");
  const [mode, setMode] = useState<"same" | "each">(draft.mode === "each" ? "each" : "same");
  const [style, setStyle] = useState<number>(typeof draft.style === "number" ? draft.style : 0);
  const [wish, setWish] = useState<string>(typeof draft.wish === "string" ? draft.wish : "");
  const [rows, setRows] = useState<{ style: number; wish: string }[]>(Array.isArray(draft.rows) ? draft.rows : []);
  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ preset, custom, mode, style, wish, rows })); } catch { /* private mode */ }
  }, [preset, custom, mode, style, wish, rows]);
  const parsed = custom === "" ? ({ ok: true, n: preset } as const) : parseQuantity(custom);
  const qtyValid = parsed.ok;
  const qty = parsed.ok ? parsed.n : 0;
  const [ack, setAck] = useState(false);
  const step = useSyncExternalStore(purchaseFlow.subscribe, purchaseFlow.get);
  const setStep = purchaseFlow.set;
  const pendingVersion = useSyncExternalStore(pendingStore.subscribe, pendingStore.version);
  // a purchase sent earlier (this session or before a reload) that has no settled receipt yet
  const pendingBuy = useMemo(() => pendingStore.list().filter((t) => t.kind === "buy").at(-1) ?? null, [pendingVersion]);
  // clear the visible draft when a purchase confirms while this form is open (not for one confirmed before it opened)
  const seenDone = useRef(step?.name === "done" ? step.hash : null);
  useEffect(() => {
    if (step?.name !== "done" || seenDone.current === step.hash) return;
    seenDone.current = step.hash;
    setWish(""); setRows([]); setAck(false);
    clearDraft();
  }, [step]);

  // One effective mode drives both the editor that is shown and the items that are validated and
  // submitted: a single candle always uses the visible single-candle style and wish.
  const each = mode === "each" && qty > 1;
  const items = useMemo(() => {
    if (!each) return Array.from({ length: qty }, () => ({ style, wish }));
    return Array.from({ length: qty }, (_, i) => rows[i] ?? { style, wish: "" });
  }, [each, qty, style, wish, rows]);
  const checks = items.map((it) => checkWish(it.wish));
  const wishBytes = checks.reduce((a, c) => a + c.bytes, 0);
  const hasWish = items.some((it) => it.wish.length > 0);
  const bound = gasBound(qty, wishBytes);
  const needApproval = !wallet.data || wallet.data.allowance < BigInt(qty) * 10n ** 18n;
  // A gas quote is current only while the query has fresh data; a failed refetch withdraws it.
  const gasOk = gas.data !== undefined && !gas.isError;
  const gasEth = gasOk ? (bound + (needApproval ? 60_000n : 0n)) * gas.data! : undefined;
  const total = BigInt(qty) * 10n ** 18n;

  const open = status.data?.open === true;
  const problems: string[] = [];
  if (FIXTURE !== null) problems.push("Test fixture: simulated candles, transactions disabled.");
  if (status.isError) problems.push("The sales status could not be read. Purchasing stays off until it loads.");
  else if (status.data && !open)
    problems.push(!status.data.activated ? "Sales are closed: the owner has not activated the garden yet." : "Sales are paused by the owner.");
  if (!qtyValid) problems.push("Fix the number of candles.");
  if (!isConnected) problems.push("Connect a wallet to light candles.");
  else if (chainId !== 1) problems.push("Switch your wallet to Ethereum.");
  if (checks.some((c) => !c.ok)) problems.push("Fix the wish marked above.");
  if (bound > TX_GAS_CAP) problems.push("This batch is too large for one Ethereum transaction. Buy fewer candles or shorten the wishes, and split it into several purchases.");
  if (hasWish && !ack) problems.push("Confirm that your wish will be public and permanent.");
  if (gas.isError) problems.push("The ETH gas estimate could not be read. Retry it before approving.");
  else if (!gasOk) problems.push("Reading the current gas price for the ETH estimate…");
  if (wallet.data && wallet.data.balance < total) problems.push(`You hold ${imd(wallet.data.balance)} IMD; this needs ${qty}.`);
  const running = isRunning(step) || pendingBuy !== null;
  const disabled = problems.length > 0 || running;

  async function submit() {
    if (FIXTURE !== null) return setStep({ name: "error", message: FIXTURE_MESSAGE }); // fixture pages never reach the wallet
    if (inFlight || isRunning(purchaseFlow.get()) || pendingStore.list().some((t) => t.kind === "buy")) return; // duplicate-send guard
    inFlight = true;
    const account = address!;
    try {
      await runPurchase(
        {
          account,
          chainId: () => chainId ?? 0,
          salesOpen: async () => {
            const [a, p] = await Promise.all([
              ethClient.readContract({ address: GARDEN, abi: wishGardenAbi, functionName: "activated" }),
              ethClient.readContract({ address: GARDEN, abi: wishGardenAbi, functionName: "purchasesPaused" }),
            ]);
            return a && !p;
          },
          balance: () => ethClient.readContract({ address: IMD, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          allowance: () => ethClient.readContract({ address: IMD, abi: erc20Abi, functionName: "allowance", args: [account, GARDEN] }),
          ethBalance: () => ethClient.getBalance({ address: account }),
          approve: (amount) => writeContract(config, { address: IMD, abi: erc20Abi, functionName: "approve", args: [GARDEN, amount], chainId: 1 }),
          // follows sped-up or cancelled replacements; the purchase is settled from the mined receipt's own logs
          wait: async (hash: Hash) => {
            const rec = await waitForTransactionReceipt(config, { hash, chainId: 1 });
            return readReceipt(rec, (await minedTx(rec.transactionHash)) ?? undefined);
          },
          submission: () => submissionMeta(account),
          sentTx,
          readOnly: FIXTURE !== null,
          remember: rememberTx,
          simulate: async (styles, wishes) => {
            const { request } = await simulateContract(config, {
              address: GARDEN, abi: wishGardenAbi, functionName: "buyCandles", args: [styles, wishes], account, chainId: 1,
            });
            return request;
          },
          buy: (request) => writeContract(config, request as any),
          explain: explainError,
        },
        items.map((i) => i.style),
        items.map((i) => i.wish),
        (s) => {
          if (s.name === "done") clearDraft(); // a confirmed purchase ends the draft; errors and replacements keep it
          setStep(s);
          if (s.name === "done") {
            store.sync().then(() => onLit(s.firstId, s.quantity ?? items.length));
            qc.invalidateQueries();
          }
        },
      );
    } finally {
      inFlight = false;
    }
  }

  return (
    <section aria-labelledby="light-title" className="light">
      <div className="light-head">
        <h2 id="light-title">Light your candle</h2>
        <p className="light-price">1 IMD per candle</p>
      </div>
      <CandlePreview style={each ? items[0]?.style ?? style : style} />
      {status.data && !open && (
        <p className="notice" role="status">
          {status.data.activated ? "Sales are paused by the owner." : "Sales are closed: the garden has not been activated yet."} You can still compose a candle, browse the garden and claim any rewards.
        </p>
      )}

      {/* while a sent purchase has no settled receipt, its draft is locked so it cannot be sent a second time */}
      <fieldset className="draft-lock" disabled={running}>
      {!each && (
        <>
          <StylePicker value={style} onChange={setStyle} name="style-all" />
          <WishField id="wish-all" value={wish} onChange={setWish} label={qty > 1 ? `Wish for all ${qty} candles (optional)` : "Your wish (optional)"} />
        </>
      )}
      <p className="public-note">Wishes are public and permanent onchain: anyone can read them, and they can never be edited or deleted.</p>

      <fieldset className="field">
        <legend>How many candles</legend>
        <div className="seg qty">
          {[1, 5, 10].map((n) => (
            <button key={n} type="button" className={preset === n && custom === "" ? "on" : ""} aria-pressed={preset === n && custom === ""} onClick={() => { setCustom(""); setPreset(n); }}>{n}</button>
          ))}
          <label className={custom !== "" ? "custom on" : "custom"}>
            <span>Custom</span>
            <input id="qty-custom" type="text" inputMode="numeric" autoComplete="off" value={custom} placeholder={`1–${MAX_BATCH}`}
              aria-invalid={!qtyValid} aria-describedby="qty-help" onChange={(e) => setCustom(e.target.value)} />
          </label>
        </div>
        <p id="qty-help" className={qtyValid ? "fine" : "count bad"} role={qtyValid ? undefined : "alert"}>
          {parsed.ok ? `${qty} candle${qty > 1 ? "s" : ""}, from 1 to ${MAX_BATCH}. New candles take the next free places in the garden.` : parsed.error}
        </p>
      </fieldset>

      {qty > 1 && (
        <fieldset className="field">
          <legend>Style and wish</legend>
          <div className="seg">
            <button type="button" className={mode === "same" ? "on" : ""} aria-pressed={mode === "same"} onClick={() => setMode("same")}>Same for all</button>
            <button type="button" className={mode === "each" ? "on" : ""} aria-pressed={mode === "each"} onClick={() => { setRows(items.map((i) => ({ ...i }))); setMode("each"); }}>One per candle</button>
          </div>
        </fieldset>
      )}

      {each && (
        <ol className="rows">
          {items.map((it, i) => (
            <li key={i}>
              <h3>Candle {i + 1}</h3>
              <StylePicker value={it.style} name={`style-${i}`} onChange={(v) => setRows((r) => { const n = [...items]; n[i] = { ...n[i], style: v }; return n; })} />
              <WishField id={`wish-${i}`} label="Wish (optional)" value={it.wish} onChange={(v) => setRows(() => { const n = [...items]; n[i] = { ...n[i], wish: v }; return n; })} />
            </li>
          ))}
        </ol>
      )}

      {hasWish && (
        <label className="check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I understand my wish is public, stored on Ethereum forever and can never be edited or deleted.</span>
        </label>
      )}
      </fieldset>

      <p className="total"><span>Total</span> <strong>{qtyValid ? `${qty} IMD` : "—"}</strong></p>
      <ol className="stages" aria-label="Purchase stages">
        <li className={stageClass(step, "approve", needApproval)}>{needApproval ? `Approve exactly ${qtyValid ? qty : "…"} IMD` : "Approval covered"}</li>
        <li className={stageClass(step, "buy", needApproval)}>Confirm the purchase</li>
        <li className={stageClass(step, "done", needApproval)}>Receipt verified, candles lit</li>
      </ol>

      {gas.isError && (
        <button type="button" className="btn" onClick={() => gas.refetch()} disabled={gas.isFetching}>
          {gas.isFetching ? "Retrying gas estimate…" : "Retry gas estimate"}
        </button>
      )}
      {!isConnected && <ConnectButton label="Connect wallet to light" />}
      {isConnected && chainId !== 1 && <WrongNetwork action="light candles" />}
      {problems.length > 0 && !running && (
        <ul className="problems" aria-live="polite">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {isConnected && (
        <button type="button" className="cta wide" disabled={disabled} aria-disabled={disabled} onClick={submit}>
          {pendingBuy && !isRunning(step) ? "Waiting for the earlier purchase" : running ? "Working…" : !qtyValid ? "Enter 1 to 50 candles" : needApproval && address ? `Approve and light ${qty} candle${qty > 1 ? "s" : ""}` : `Light ${qty} candle${qty > 1 ? "s" : ""}`}
        </button>
      )}
      <p className="net-line">Ethereum · gas paid separately</p>
      <div aria-live="polite" className="steps">
        {step && step.name !== "error" && step.name !== "buy-unknown" && (
          <p>
            {STEP_TEXT[step.name]}{" "}
            {"hash" in step && <a href={`${ETHERSCAN}/tx/${step.hash}`} target="_blank" rel="noreferrer">View transaction</a>}
          </p>
        )}
        {step?.name === "error" && (
          <p className="bad" role="alert">
            {step.message}{" "}
            {step.hash && <a href={`${ETHERSCAN}/tx/${step.hash}`} target="_blank" rel="noreferrer">View the confirmed transaction</a>}
          </p>
        )}
        {pendingBuy && (step?.name === "buy-unknown" || !isRunning(step)) && (
          <div className="pending-box" role="status">
            <p>
              {step?.name === "buy-unknown" ? step.message : "A purchase you sent earlier has no receipt yet. This draft stays locked so it is not sent twice."}{" "}
              <a href={`${ETHERSCAN}/tx/${pendingBuy.hash}`} target="_blank" rel="noreferrer">View pending transaction</a>
            </p>
            <div className="pending-acts">
              <button type="button" className="btn" onClick={() => recoverBuy(pendingBuy)}>Check again</button>
              <button type="button" className="link" onClick={() => { pendingStore.remove(pendingBuy.hash); setStep(null); }}>
                Forget it: my wallet shows it was dropped
              </button>
            </div>
          </div>
        )}
      </div>

      <details className="costs">
        <summary>Cost details</summary>
        <dl className="summary">
          <div><dt>Candles</dt><dd>{qtyValid ? qty : "—"}</dd></div>
          <div><dt>Total</dt><dd>{qtyValid ? `${qty} IMD` : "—"}</dd></div>
          <div><dt>Your balance</dt><dd>{address ? (wallet.data ? `${imd(wallet.data.balance)} IMD` : "…") : "Not connected"}</dd></div>
          <div><dt>Approval</dt><dd>{!qtyValid ? "—" : address && wallet.data ? (needApproval ? `Needed: exactly ${qty} IMD` : "Already covered") : "Checked when you connect"}</dd></div>
          <div><dt>Estimated gas</dt><dd>{gasEth !== undefined ? `≤ ${eth(gasEth)} ETH` : gas.isError ? "Unavailable" : "Reading…"}</dd></div>
        </dl>
        <p className="fine">Gas is an upper bound from the contract docs ({bound.toLocaleString("en-US")} gas for this batch{needApproval ? " plus about 60,000 for the approval" : ""}) at the current gas price. All seven styles cost the same and carry the same rights. Candles appear in the garden only after the purchase receipt is verified.</p>
      </details>
    </section>
  );
}

/** The three purchase stages, marked from the shared purchase step. */
function stageClass(step: Step | null, stage: "approve" | "buy" | "done", needApproval: boolean): string {
  const n = step?.name;
  const at = n === "approve-wallet" || n === "approve-pending" ? 0 : n === "simulating" || n === "buy-wallet" || n === "buy-pending" || n === "buy-unknown" ? 1 : n === "done" ? 3 : -1;
  const i = ["approve", "buy", "done"].indexOf(stage);
  if (stage === "approve" && !needApproval && at < 0) return "stage ok";
  if (at > i) return "stage ok";
  if (at === i) return "stage now";
  return "stage";
}

/** Wick row of each style in its 10x16 pixel sprite, so the preview flame sits on the wick (art pixels from the top). */
const WICK = [1, 4, 8, 8, 2, 5, 8];
/** Purchase preview in the garden's pixel art: arch, founding pedestal, the chosen candle sprite and its flame frames, 3x. */
export function CandlePreview({ style }: { style: number }) {
  return (
    <div className="preview px-preview" aria-hidden="true">
      <img className="px pv-glow" src="./art/px/glow.png" alt="" />
      <img className="px pv-arch" src="./art/px/arch.png" alt="" />
      <img className="px pv-bush l" src="./art/px/bush-flower.png" alt="" />
      <img className="px pv-bush r" src="./art/px/bush-flower.png" alt="" />
      <img className="px pv-ped" src="./art/px/pedestal-hero.png" alt="" />
      <img className="px pv-candle" src={ART(style)} alt="" />
      {[0, 1, 2, 3].map((k) => (
        <img key={k} className={`px pv-flame f${k}`} src={`./art/px/flame-${k}.png`} alt="" style={{ bottom: `${116 - (WICK[style] ?? 1) * 3 - 3}px` }} />
      ))}
    </div>
  );
}
