import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { ETHERSCAN, ethClient } from "./config";
import { Garden, type GardenHandle } from "./garden/Garden";
import { ConnectSheet } from "./components/ConnectSheet";
import { LightPanel } from "./panels/LightPanel";
import { CandleDetail, HowPanel, MinePanel, Register, RewardsPanel, TreasuryPanel } from "./panels/Panels";
import { FIXTURE, store, useCandles, useMyIds, useReducedMotion, useStatus } from "./hooks";
import { pendingStore, type PendingTx } from "./lib/purchase";
import type { Candle } from "./lib/candles";

const ROUTES = [
  ["garden", "Garden"],
  ["mine", "My Candles"],
  ["rewards", "Rewards"],
  ["treasury", "Treasury"],
  ["light", "Light a candle"],
  ["how", "How it works"],
] as const;
/** Header tabs, in the reference order; Light a candle and How it works live in the side actions. */
const NAV = ROUTES.slice(0, 4);
/** Contract split of every 1 IMD candle (WishGarden): unchanged economics. */
const SPLIT = [
  ["30%", "Burn", "flame"],
  ["30%", "Previous paid candles", "layers"],
  ["30%", "Ecosystem", "sprout"],
  ["5%", "Operations", "gear"],
  ["5%", "Founder", "people"],
] as const;
const ICON: Record<string, string> = {
  flame: "M12 3c1 3 4 4.5 4 8.5A4 4 0 0 1 8 11.5C8 9 10 8 10 6c1.2.8 1.6 1.7 2-3Z",
  layers: "M12 4 3 8.5l9 4.5 9-4.5L12 4Zm-9 8.5 9 4.5 9-4.5M3 16.5 12 21l9-4.5",
  sprout: "M12 20v-8m0 0C12 7 8.5 5 4 5c0 4.5 3 7 8 7Zm0 0c0-4 3-6.5 8-6.5 0 4-3 6.5-8 6.5Z",
  gear: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM12 3v2.5m0 13V21M3 12h2.5m13 0H21M5.6 5.6l1.8 1.8m9.2 9.2 1.8 1.8m0-12.8-1.8 1.8m-9.2 9.2-1.8 1.8",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 0a2.5 2.5 0 1 0 0-5M3 19c.5-3.5 3-5 6-5s5.5 1.5 6 5m1-5c2.5 0 4.5 1.5 5 5",
};
const Icon = ({ name }: { name: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={ICON[name]} /></svg>
);
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

function useNarrow() {
  const q = "(max-width: 900px)";
  const [n, setN] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setN(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [selected, setSelected] = useState<number | null>(null);
  const [highlightMine, setHighlightMine] = useState(false);
  const [query, setQuery] = useState("");
  const [findError, setFindError] = useState<string | null>(null);
  const [findBusy, setFindBusy] = useState<number | null>(null);
  const [extra, setExtra] = useState<Candle | null>(null); // a record read by Find before its page streamed in
  const [menu, setMenu] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
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
  const narrow = useNarrow();

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
  // Escape closes the innermost layer: the candle popup, then the menu, then an open panel.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".sheet-bg")) return; // the connect sheet handles its own Escape
      if (selected) setSelected(null);
      else if (menu) setMenu(false);
      else if (route !== "garden") location.hash = "#/garden";
    };
    addEventListener("keydown", f);
    return () => removeEventListener("keydown", f);
  }, [selected, menu, route]);
  useEffect(() => {
    const t = ROUTES.find(([k]) => k === route)![1];
    document.title = route === "garden" ? "Everlight Garden: light a permanent candle" : `${t} · Everlight Garden`;
  }, [route]);

  const jump = (id: number) => {
    setSelected(id);
    garden.current?.jumpTo(id);
  };
  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = Number(query.trim().replace(/^#/, ""));
    if (!Number.isInteger(id) || id < 1) return setFindError("Enter a candle number such as 12.");
    if (findBusy !== null) return;
    if (cs.candles[id - 1]) {
      setFindError(null);
      return jump(id);
    }
    setFindBusy(id);
    setFindError(null);
    try {
      const r = await store.lookup(id);
      if (r.kind === "none") setFindError(r.total === 0 ? "No candle has been lit yet." : `Candle #${id} does not exist yet. The newest is #${r.total}.`);
      else {
        if (!store.get(id)) setExtra(r.candle);
        jump(id);
      }
    } catch {
      setFindError(`Candle #${id} could not be loaded. Try again.`);
    } finally {
      setFindBusy(null);
    }
  };

  const sel = selected ? cs.candles[selected - 1] ?? (extra?.id === selected ? extra : undefined) : undefined;
  const salesLine = status.data
    ? status.data.open ? "Sales open · 1 IMD per candle" : status.data.activated ? "Sales paused" : "Sales closed until activation"
    : status.isError ? "Sales status unavailable" : "Reading sales status…";

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to the garden tools</a>
      <header className="top">
        <a className="brand" href="#/garden" aria-label="Everlight Garden, home">
          <img src="./favicon.svg" alt="" width={32} height={32} />
          <span className="brand-name">Everlight Garden</span><span className="brand-on"> · on IMD</span>
        </a>
        <nav aria-label="Main" className={menu ? "nav open" : "nav"}>
          {(menu ? ROUTES : NAV).map(([k, label]) => (
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
        known={Math.max(total, cs.total ?? 0)}
        extra={extra}
        candles={cs.candles}
        selected={selected}
        mine={mine}
        highlightMine={highlightMine}
        reducedMotion={reduced}
        onSelect={setSelected}
        handleRef={(h) => (garden.current = h)}
        onStats={setStats}
        onAnchor={setAnchor}
      />

      <div className="frames" aria-hidden="true">
        <img className="fr-canopy" src="./art/canopy.webp" alt="" />
        <img className="fr-left" src="./art/frame-left.webp" alt="" />
        <img className="fr-right" src="./art/frame-right.webp" alt="" />
      </div>

      <main id="main" className="overlay">
        {route === "garden" && (
          <div className="intro">
            <h1>Light a wish in the garden</h1>
            <p className="intro-line">Permanent candles on Ethereum: 1 IMD each, with a public wish.</p>
            <a className="cta intro-cta" href="#/light">Light a candle · 1 IMD</a>
            <p className="status-line" role="status">
              <span className={`dot ${status.data?.open ? "on" : ""}`} aria-hidden="true" /> {salesLine} · {cs.total === null ? "counting candles…" : `${total} lit`}
              {cs.loading && cs.total !== null && total < cs.total ? ` (loading ${total} of ${cs.total})` : ""}
            </p>
            {cs.error && <p className="bad" role="alert">Candles could not be read: the RPCs did not answer. Retrying every 30 seconds.</p>}
            {FIXTURE !== null && <p className="fixture">Test fixture: {FIXTURE} simulated candles, not onchain.</p>}
          </div>
        )}

        <nav className="side" aria-label="Quick actions">
          <a className="side-act" href="#/light"><img src="./art/candle-0.svg" alt="" width={20} height={40} /><span>Light a candle · 1 IMD</span></a>
          <a className="side-act" href="#/rewards"><Icon name="layers" /><span>My rewards</span></a>
          <a className="side-act" href="#/how"><Icon name="sprout" /><span>How it works</span></a>
        </nav>

        <div className={route === "garden" ? "strip" : "strip strip-under"}>
          <form className="find" onSubmit={find} role="search">
            <label htmlFor="find" className="sr">Find a candle by its number</label>
            <svg className="find-ic" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>
            <input id="find" inputMode="numeric" placeholder="Candle #" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby={findError ? "find-err" : undefined} />
            <button className="btn" type="submit" disabled={findBusy !== null}>Find<span className="wide-only">{"\u00a0"}my candle</span></button>
          </form>
          <div className="map-slot" aria-hidden="true" />
          <details className="split" open={!narrow}>
            <summary>Split of 1 IMD</summary>
            <ul>
              {SPLIT.map(([pct, label, ic]) => (
                <li key={label}><Icon name={ic} /><strong>{pct}</strong> {label}</li>
              ))}
            </ul>
          </details>
          {findBusy !== null && <p className="find-err find-wait" role="status">Loading candle #{findBusy}…</p>}
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

        {sel && (
          <div
            className={anchor && !narrow ? "detail-wrap anchored" : "detail-wrap"}
            style={anchor && !narrow ? { left: Math.min(Math.max(anchor.x, 190), innerWidth - 190), top: anchor.y - 14 } : undefined}
          >
            <CandleDetail c={sel} mine={mine.has(sel.id)} onClose={() => setSelected(null)} />
          </div>
        )}

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
