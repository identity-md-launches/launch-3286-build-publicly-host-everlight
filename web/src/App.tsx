import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { ETHERSCAN, ethClient } from "./config";
import { Garden, type GardenHandle } from "./garden/Garden";
import { ConnectSheet } from "./components/ConnectSheet";
import { LightPanel } from "./panels/LightPanel";
import { CandleDetail, HowPanel, MinePanel, Register, RewardsPanel, TreasuryPanel } from "./panels/Panels";
import { FIXTURE, store, useCandles, useMyIds, useReducedMotion, useStatus } from "./hooks";
import { pendingStore, type PendingTx } from "./lib/purchase";

const ROUTES = [
  ["garden", "Garden"],
  ["light", "Light a candle"],
  ["mine", "My candles"],
  ["rewards", "Rewards"],
  ["treasury", "Treasury"],
  ["how", "How it works"],
] as const;
type Route = (typeof ROUTES)[number][0];

const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.some(([k]) => k === r) ? r : "garden";
};

interface Toast { id: string; text: string; href?: string; bad?: boolean }

/** Re-attach to transactions sent before a reload and report their receipts. */
function usePendingRecovery(push: (t: Toast) => void) {
  useEffect(() => {
    const list = pendingStore.list();
    list.forEach((tx: PendingTx) => {
      push({ id: tx.hash, text: `Checking a ${tx.kind === "buy" ? "purchase" : tx.kind} sent earlier…`, href: `${ETHERSCAN}/tx/${tx.hash}` });
      ethClient
        .waitForTransactionReceipt({ hash: tx.hash, timeout: 10 * 60_000 })
        .then((r) => {
          pendingStore.remove(tx.hash);
          const ok = r.status === "success";
          push({ id: tx.hash, bad: !ok, href: `${ETHERSCAN}/tx/${tx.hash}`, text: ok ? (tx.kind === "buy" ? "Your earlier purchase confirmed. Its candles are lit." : `Your earlier ${tx.kind} confirmed.`) : `Your earlier ${tx.kind === "buy" ? "purchase" : tx.kind} reverted.` });
          if (ok) store.sync();
        })
        .catch(() => push({ id: tx.hash, bad: true, href: `${ETHERSCAN}/tx/${tx.hash}`, text: "An earlier transaction has no receipt yet. It is still saved; reload later to check again." }));
    });
  }, []);
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [selected, setSelected] = useState<number | null>(null);
  const [highlightMine, setHighlightMine] = useState(false);
  const [query, setQuery] = useState("");
  const [findError, setFindError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stats, setStats] = useState<{ fps: number; ms: number; drawn: number; lod: number; missing: number } | null>(null);
  const garden = useRef<GardenHandle | null>(null);
  const panelHeading = useRef<HTMLDivElement>(null);
  const cs = useCandles();
  const status = useStatus();
  const reduced = useReducedMotion();
  const { address } = useAccount();
  const myIds = useMyIds(address);
  const mine = useMemo(() => new Set(myIds.data ?? []), [myIds.data]);
  const total = cs.candles.length;

  const push = (t: Toast) => setToasts((l) => [...l.filter((x) => x.id !== t.id), t].slice(-3));
  usePendingRecovery(push);

  useEffect(() => {
    const f = () => {
      setRoute(readRoute());
      setMenu(false);
    };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (route !== "garden") panelHeading.current?.focus();
  }, [route]);
  useEffect(() => {
    const t = ROUTES.find(([k]) => k === route)![1];
    document.title = route === "garden" ? "Everlight Garden: light a permanent candle" : `${t} · Everlight Garden`;
  }, [route]);

  const jump = (id: number) => {
    setSelected(id);
    garden.current?.jumpTo(id);
  };
  const find = (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(query.replace(/^#/, ""));
    if (!Number.isInteger(id) || id < 1) return setFindError("Enter a candle number such as 12.");
    if (id > total) return setFindError(total === 0 ? "No candle has been lit yet." : `Candle #${id} does not exist yet. The newest is #${total}.`);
    setFindError(null);
    jump(id);
  };

  const sel = selected ? cs.candles[selected - 1] : undefined;
  const salesLine = status.data
    ? status.data.open ? "Sales open · 1 IMD per candle" : status.data.activated ? "Sales paused" : "Sales closed until activation"
    : status.isError ? "Sales status unavailable" : "Reading sales status…";

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to the garden tools</a>
      <header className="top">
        <a className="brand" href="#/garden" aria-label="Everlight Garden, home">
          <img src="./favicon.svg" alt="" width={28} height={28} />
          <span>Everlight Garden</span>
        </a>
        <nav aria-label="Main" className={menu ? "nav open" : "nav"}>
          {ROUTES.map(([k, label]) => (
            <a key={k} href={`#/${k}`} aria-current={route === k ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <div className="top-end">
          <button className="icon-btn menu-btn" aria-expanded={menu} aria-label="Open the page menu" onClick={() => setMenu((m) => !m)}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
          <ConnectSheet />
        </div>
      </header>

      <Garden
        total={total}
        candles={cs.candles}
        selected={selected}
        mine={mine}
        highlightMine={highlightMine}
        reducedMotion={reduced}
        onSelect={setSelected}
        handleRef={(h) => (garden.current = h)}
        onStats={setStats}
      />

      <main id="main" className="overlay">
        {route === "garden" && (
          <div className="intro">
            <h1>Light a candle that stays</h1>
            <p>Each candle is a permanent record on Ethereum: 1 IMD, one of seven styles and an optional public wish.</p>
            <p className="status-line" role="status">
              <span className={`dot ${status.data?.open ? "on" : ""}`} aria-hidden="true" /> {salesLine} · {cs.total === null ? "counting candles…" : `${total} lit`}
              {cs.loading && cs.total !== null && total < cs.total ? ` (loading ${total} of ${cs.total})` : ""}
            </p>
            {cs.error && <p className="bad" role="alert">Candles could not be read: the RPCs did not answer. Retrying every 30 seconds.</p>}
            {FIXTURE !== null && <p className="fixture">Test fixture: {FIXTURE} simulated candles, not onchain.</p>}
          </div>
        )}

        <div className={route === "garden" ? "dock" : "dock dock-under"}>
          <a className="cta" href="#/light">Light a candle</a>
          <form className="find" onSubmit={find} role="search">
            <label htmlFor="find" className="sr">Find candle by number</label>
            <input id="find" inputMode="numeric" placeholder="Candle #" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby={findError ? "find-err" : undefined} />
            <button className="btn" type="submit">Find</button>
          </form>
          <a className="btn" href="#/mine">My candles</a>
          {findError && <p id="find-err" className="find-err" role="alert">{findError}</p>}
        </div>

        {route !== "garden" && (
          <aside tabIndex={-1} className="panel" aria-label={ROUTES.find(([k]) => k === route)![1]} ref={panelHeading}>
            <a className="x panel-x" href="#/garden" aria-label="Close panel and return to the garden">×</a>
            <div className="panel-body">
              {route === "light" && <LightPanel onLit={(id) => { if (id) jump(id); location.hash = "#/garden"; }} />}
              {route === "mine" && <MinePanel candles={cs.candles} onJump={jump} highlight={highlightMine} setHighlight={setHighlightMine} />}
              {route === "rewards" && <RewardsPanel />}
              {route === "treasury" && <TreasuryPanel />}
              {route === "how" && <HowPanel />}
              {(route === "mine" || route === "how") && <Register candles={cs.candles} onJump={jump} />}
            </div>
          </aside>
        )}

        {sel && <div className="detail-wrap"><CandleDetail c={sel} mine={mine.has(sel.id)} onClose={() => setSelected(null)} /></div>}

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <p key={t.id} className={t.bad ? "toast bad" : "toast"}>
              {t.text} {t.href && <a href={t.href} target="_blank" rel="noreferrer">View</a>}
              <button className="link" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))} aria-label="Dismiss">Dismiss</button>
            </p>
          ))}
        </div>
      </main>
      {stats && <output className="sr" data-testid="render-stats" data-fps={stats.fps} data-ms={stats.ms} data-drawn={stats.drawn} data-lod={stats.lod} data-missing={stats.missing} />}
    </div>
  );
}
