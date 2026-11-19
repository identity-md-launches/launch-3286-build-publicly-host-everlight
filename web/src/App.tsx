import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { placePopup, type Placement } from "./lib/popup";
import { useAccount } from "wagmi";
import { ETHERSCAN } from "./config";
import { Garden, SHEET_QUERY, type GardenHandle } from "./garden/Garden";
import { ConnectSheet } from "./components/ConnectSheet";
import { LightPanel, recoverBuy } from "./panels/LightPanel";
import { CandleDetail, HowPanel, MinePanel, Register, RewardsPanel, TreasuryPanel } from "./panels/Panels";
import { FIXTURE, store, useCandles, useMyIds, useReducedMotion, useStatus } from "./hooks";
import { UNVERIFIED_MESSAGE, pendingStore, type PendingTx } from "./lib/purchase";
import { settleReceipt } from "./lib/chain";
import { settleClaim } from "./lib/receipt";
import { imd } from "./lib/format";
import type { Candle } from "./lib/candles";
import { ignite, newIds } from "./garden/ignite";

const ROUTES = [
  ["garden", "Garden"],
  ["mine", "My Candles"],
  ["rewards", "Rewards"],
  ["treasury", "Treasury"],
  ["light", "Light a candle"],
  ["how", "How it works"],
] as const;
/** Header tabs, in the reference order; Light a candle and How it works live in the side actions. */
const NAV = [...ROUTES.slice(0, 4), ROUTES[5]];
/** At this width the Light your candle form is docked beside the garden, as in the approved design. */
const DOCK_QUERY = "(min-width: 1180px)";
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
/** Routes that show the garden with its candle details: the garden, and Light a candle while docked beside it. */
const detailRoute = (r: Route) => r === "garden" || (r === "light" && matchMedia(DOCK_QUERY).matches);
// Fixture pages only: lets the labelled browser checks start an ignition without any purchase (visual only).
if (FIXTURE !== null) (window as unknown as { __igniteForTest?: (id: number) => void }).__igniteForTest = (id) => ignite([id]);
const FIXTURE_NOTE = `Test fixture (${FIXTURE ?? 0} simulated candles), transactions disabled.`;

const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.some(([k]) => k === r) ? r : "garden";
};

interface Toast { id: string; text: string; href?: string; bad?: boolean }

/** Re-attach to transactions sent before a reload and report their receipts. */
function usePendingRecovery(push: (t: Toast) => void, onLit: (firstId: number, quantity: number) => void) {
  useEffect(() => {
    const list = pendingStore.list();
    list.forEach((tx: PendingTx) => {
      push({ id: tx.hash, text: `Checking a ${tx.kind === "buy" ? "purchase" : tx.kind} sent earlier…`, href: `${ETHERSCAN}/tx/${tx.hash}` });
      if (tx.kind === "buy") {
        // a purchase is settled only by the garden's CandlesPurchased event in the mined (possibly replacement)
        // receipt; until then the Light a candle form stays locked on the same draft
        recoverBuy(tx).then((s) => {
          if (s.name === "done") {
            push({ id: tx.hash, href: `${ETHERSCAN}/tx/${s.hash}`, text: "Your earlier purchase confirmed. Its candles are lit." });
            // verified receipt and events: focus the new candles and light them
            store.sync().then(() => { if (s.firstId) onLit(s.firstId, s.quantity ?? tx.quantity ?? 1); });
          } else if (s.name === "error") push({ id: tx.hash, bad: true, href: `${ETHERSCAN}/tx/${s.hash ?? tx.hash}`, text: s.hash ? s.message : `Your earlier purchase did not light candles. ${s.message}` });
          else if (s.name === "buy-unknown" && s.message === UNVERIFIED_MESSAGE) push({ id: tx.hash, bad: true, href: `${ETHERSCAN}/tx/${tx.hash}`, text: s.message });
          else push({ id: tx.hash, bad: true, href: `${ETHERSCAN}/tx/${tx.hash}`, text: "An earlier purchase has no receipt yet. It is still saved; Light a candle stays locked on it." });
        });
        return;
      }
      // approvals and claims: follow a replacement from the saved sender/nonce; a claim counts only with the
      // garden RewardsClaimed event for this account in the mined transaction (never for a cancel/self-transfer)
      settleReceipt(tx.hash, tx)
        .then(({ receipt: r, mined }) => {
          const href = `${ETHERSCAN}/tx/${r.transactionHash}`;
          if (tx.kind === "claim") {
            const v = settleClaim(r, mined, tx.account);
            if (!("unverified" in v && v.unverified)) pendingStore.remove(tx.hash); // unverified claims stay saved
            push({ id: tx.hash, bad: !v.ok, href, text: v.ok ? `Your earlier claim confirmed: ${imd(v.amount)} IMD claimed.` : v.message });
          } else {
            pendingStore.remove(tx.hash);
            const ok = r.status === "success" && r.transactionHash === tx.hash;
            push({ id: tx.hash, bad: !ok, href, text: ok ? "Your earlier approval confirmed." : "Your earlier approval was replaced or reverted; approve again when you light candles." });
          }
          store.sync();
        })
        .catch(() => push({ id: tx.hash, bad: true, href: `${ETHERSCAN}/tx/${tx.hash}`, text: "An earlier transaction has no receipt yet. It is still saved; reload later to check again." }));
    });
  }, []);
}

function useNarrow(q = SHEET_QUERY) {
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
  const wide = useNarrow(DOCK_QUERY);
  const docked = wide && (route === "garden" || route === "light");
  // the docked purchase panel can be collapsed to a slim tab so the garden takes the full width;
  // opening Light a candle (#/light) always brings it back
  const [dockHidden, setDockHidden] = useState(false);
  useEffect(() => { if (route === "light") setDockHidden(false); }, [route]);
  const dockOpen = docked && !dockHidden;
  const dockToggle = useRef<HTMLButtonElement>(null);
  const dockFocus = useRef(false);
  useEffect(() => {
    if (!dockFocus.current) return;
    dockFocus.current = false;
    dockToggle.current?.focus();
  }, [dockHidden]);
  const toggleDock = (hidden: boolean) => { dockFocus.current = true; setDockHidden(hidden); };
  // the split disclosure is a sheet on phones: while it is open the map tools step aside
  const [splitOpen, setSplitOpen] = useState(() => !matchMedia(SHEET_QUERY).matches);
  useEffect(() => setSplitOpen(!narrow), [narrow]);
  // anchored desktop popup: measured, then placed between header and strip, clear of the headline
  const popRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<(Placement & { base: number }) | null>(null);
  // desktop selection always uses the anchored placement: with no visible anchor (candle panned off screen)
  // the box is hidden, never shown detached, and returns when the candle comes back into view
  const anchored = !narrow && selected !== null;
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!anchored || !el || !anchor) return setPlace(null);
    const header = document.querySelector(".top")?.getBoundingClientRect().bottom ?? 56;
    const strip = document.querySelector(".strip")?.getBoundingClientRect().top ?? innerHeight;
    const intro = document.querySelector(".intro")?.getBoundingClientRect() ?? null;
    const base = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect().top ?? 0;
    const p = placePopup(anchor, { w: el.offsetWidth, h: el.offsetHeight }, { w: document.querySelector(".light-dock")?.getBoundingClientRect().left ?? innerWidth, top: header, bottom: strip }, intro && intro.height > 0 ? intro : null);
    setPlace((old) => (old && old.left === p.left && old.top === p.top && old.hidden === p.hidden && old.below === p.below && old.overlapsAvoid === p.overlapsAvoid && old.base === base ? old : { ...p, base }));
  });

  const push = (t: Toast) => setToasts((l) => [...l.filter((x) => x.id !== t.id), t].slice(-3));
  /** After a verified purchase receipt: return to the garden, focus the first new candle and ignite all of them. */
  const lit = (firstId: number, quantity: number) => {
    jump(firstId);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) ignite(newIds(firstId, quantity));
  };
  usePendingRecovery(push, lit);

  useEffect(() => {
    const f = () => {
      const r = readRoute();
      setRoute(r);
      setMenu(false);
      // candle details belong to the garden view (and the wide dock beside it), never over another page
      if (!detailRoute(r)) setSelected(null);
    };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (route !== "garden" && !matchMedia(DOCK_QUERY).matches) panelHeading.current?.focus();
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

  /** Select and frame a candle in the garden: from another page this first returns to the garden view. */
  const jump = (id: number) => {
    const r = readRoute();
    if (!detailRoute(r)) {
      setRoute("garden");
      setMenu(false);
      location.hash = "#/garden";
    }
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
    <div className={docked && dockHidden ? "app dock-collapsed" : "app"}>
      <a className="skip" href="#main">Skip to the garden tools</a>
      <header className="top">
        <a className="brand" href="#/garden" aria-label="Everlight Garden, home">
          <img src="./favicon.svg" alt="" width={32} height={32} />
          <span className="brand-name">Everlight Garden</span><span className="brand-on"> on IMD</span>
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
        onSelect={(id) => (id !== null && narrow ? jump(id) : setSelected(id))}
        handleRef={(h) => (garden.current = h)}
        onStats={setStats}
        onAnchor={setAnchor}
        toolsHidden={(route !== "garden" && !docked) || menu || (narrow && (!!sel || splitOpen))}
      />


      <main id="main" className="overlay">
        {(route === "garden" || docked) && (
          <div className={(anchored && place?.overlapsAvoid && !place.hidden) || (narrow && !!sel) ? "intro intro-yield" : "intro"}>
            <h1>Every wish leaves a light.</h1>
            <p className="intro-line">Write a wish and light a permanent candle in the garden for 1 IMD on Ethereum.</p>
            <a className="cta intro-cta" href="#/light">{"Light a candle\u00a0· 1\u00a0IMD"}</a>
            <p className="status-line" role="status">
              <span className={`dot ${status.data?.open ? "on" : ""}`} aria-hidden="true" /> {salesLine} · {cs.total === null ? "counting candles…" : `${total} lit`}
              {cs.loading && cs.total !== null && total < cs.total ? ` (loading ${total} of ${cs.total})` : ""}
            </p>
            {cs.error && <p className="bad" role="alert">Candles could not be read: the RPCs did not answer. Retrying every 30 seconds.</p>}
            {FIXTURE !== null && <p className="fixture">{FIXTURE_NOTE}</p>}
          </div>
        )}

        <nav className="side" aria-label="Quick actions">
          <a className="side-act" href="#/light"><img className="px" src="./art/px/candle-0.png" alt="" width={20} height={32} /><span>{"Light a candle\u00a0· 1\u00a0IMD"}</span></a>
          <a className="side-act" href="#/rewards"><Icon name="layers" /><span>My rewards</span></a>
          <a className="side-act" href="#/how"><Icon name="sprout" /><span>How it works</span></a>
        </nav>

        <div className={route === "garden" || docked ? "strip" : "strip strip-under"}>
          <form className="find" onSubmit={find} role="search">
            <label htmlFor="find" className="sr">Find a candle by its number</label>
            <svg className="find-ic" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>
            <input id="find" inputMode="numeric" placeholder="Candle #" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby={findError ? "find-err" : undefined} />
            <button className="btn" type="submit" disabled={findBusy !== null}>Find<span className="wide-only">{"\u00a0"}my candle</span></button>
          </form>
          <div className="map-slot" aria-hidden="true" />
          <details className="split" open={splitOpen} onToggle={(e) => setSplitOpen((e.currentTarget as HTMLDetailsElement).open)}>
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

        {docked && dockHidden && (
          <button ref={dockToggle} type="button" className="cta dock-tab" aria-expanded="false" onClick={() => toggleDock(false)}>
            Light a candle
          </button>
        )}
        {dockOpen && (
          <aside id="light-dock" className="light-dock" aria-label="Light your candle">
            <button ref={dockToggle} type="button" className="x panel-x dock-x" aria-expanded="true" aria-controls="light-dock" aria-label="Hide the candle panel" title="Hide the candle panel" onClick={() => toggleDock(true)}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M6 3l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {FIXTURE !== null && <p className="fixture fixture-bar" role="note">{FIXTURE_NOTE}</p>}
            <LightPanel onLit={(id, q) => { if (id) lit(id, q); }} />
          </aside>
        )}

        {route !== "garden" && !docked && (
          <aside tabIndex={-1} className="panel" aria-label={ROUTES.find(([k]) => k === route)![1]} ref={panelHeading}>
            <a className="x panel-x" href="#/garden" aria-label="Close panel and return to the garden">×</a>
            {FIXTURE !== null && <p className="fixture fixture-bar" role="note">{FIXTURE_NOTE}</p>}
            <div className="panel-body">
              {route === "light" && <LightPanel onLit={(id, q) => { if (id) lit(id, q); else location.hash = "#/garden"; }} />}
              {route === "mine" && <MinePanel candles={cs.candles} onJump={jump} highlight={highlightMine} setHighlight={setHighlightMine} />}
              {route === "rewards" && <RewardsPanel />}
              {route === "treasury" && <TreasuryPanel />}
              {route === "how" && <HowPanel />}
              {(route === "mine" || route === "how") && <Register candles={cs.candles} onJump={jump} />}
            </div>
          </aside>
        )}

        {sel && detailRoute(route) && (
          <div
            ref={popRef}
            className={anchored ? `detail-wrap anchored${place?.below ? " below" : ""}` : "detail-wrap"}
            style={anchored ? (place ? { left: place.left, top: place.top - place.base, visibility: place.hidden ? "hidden" : undefined } : { visibility: "hidden" }) : undefined}
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
