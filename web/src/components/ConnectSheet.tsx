import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { mainnet } from "wagmi/chains";
import { WALLET_ICONS } from "./walletIcons";
import { short } from "../lib/format";

/**
 * Mobile without a relay: a phone browser has no extension, so the sheet offers to open this page
 * inside a wallet's own browser, where that wallet is injected.
 */
export const OPEN_IN: ReadonlyArray<{ id: string; name: string; href: (url: string) => string }> = [
  // https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks
  { id: "metamask", name: "MetaMask", href: (url) => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}` },
  // https://docs.cdp.coinbase.com/wallet-sdk/docs/deep-link
  { id: "coinbase", name: "Coinbase Wallet", href: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  // Rabby Mobile universal link (see wallet-connectors reference)
  { id: "rabby", name: "Rabby", href: (url) => `https://go.rabby.io/mobile/dapp?url=${encodeURIComponent(url)}` },
  // https://docs.phantom.com/phantom-deeplinks/other-methods/browse
  { id: "phantom", name: "Phantom", href: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}` },
];

export const isMobileBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(window as any).ethereum;

/** The connect control and its sheet: the site's own type and colors, the network's structure. */
export function ConnectSheet() {
  const mobile = isMobileBrowser();
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Modal: Escape closes, Tab cycles inside the sheet, and everything behind it is inert.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      if (e.key !== "Tab" || !sheet.current) return;
      const items = [...sheet.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      const inside = sheet.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", onKey);
    // the sheet is portalled to <body>, so the whole app behind it can be made inert
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    sheet.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => {
      removeEventListener("keydown", onKey);
      root?.removeAttribute("inert");
      opener.current?.focus(); // focus returns to Connect once the background is interactive again
    };
  }, [open]);
  useEffect(() => { if (isConnected) setOpen(false); }, [isConnected]);
  const close = () => {
    setOpen(false);
    reset();
  };

  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")]
    .filter((c) => !(c.id === "injected" && named));
  const label = (c: Connector) => (c.id === "injected" ? "Browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name);
  const icon = (c: Connector) => c.icon ?? WALLET_ICONS[c.id];

  if (isConnected && address) {
    if (chainId !== mainnet.id)
      return (
        <div className="wallet-ctl">
          <button className="cta" onClick={() => switchChain({ chainId: mainnet.id })} disabled={switching}>
            {switching ? "Switching…" : "Switch to Ethereum"}
          </button>
          {switchError && <span className="note" role="alert">Switch in your wallet, then try again.</span>}
        </div>
      );
    return (
      <div className="wallet-ctl">
        <button className="cta ghost" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>{short(address)}</button>
        {menu && (
          <div className="wallet-menu">
            <button className="row" onClick={() => { setMenu(false); disconnect(); }}>Disconnect</button>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <button ref={opener} className="cta" aria-label="Connect wallet" onClick={() => setOpen(true)}>Connect<span className="wide-word"> wallet</span></button>
      {open && createPortal(
        <div className="sheet-bg" onClick={close}>
          <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="connect-title">Connect a wallet</h2>
              <button className="x" aria-label="Close" onClick={close}>×</button>
            </div>
            {mobile && OPEN_IN.map((w) => (
              <a key={w.id} className="row" href={w.href(location.href)}>
                <span className="ic"><img width={28} height={28} src={WALLET_ICONS[w.id]} alt="" /></span>
                <span>Open in {w.name}</span>
              </a>
            ))}
            {listed.filter((c) => !mobile || c.type !== "injected").map((c) => (
              <button key={c.uid} className="row" onClick={() => connect({ connector: c })} disabled={isPending}>
                <span className="ic">{icon(c) ? <img width={28} height={28} src={icon(c)} alt="" /> : null}</span>
                <span>{label(c)}{isPending && variables?.connector === c ? " · opening…" : ""}</span>
              </button>
            ))}
            {error && <p className="note" role="alert">{/reject|denied/i.test(error.message) ? "The wallet request was declined." : "The wallet did not connect. Try again."}</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
