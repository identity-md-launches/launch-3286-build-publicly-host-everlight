# Everlight Garden design system

Taken from the final source: `web/src/styles.css`, `web/src/garden/renderer.ts` and the components in `web/src/`.

## Overview

An immersive midnight garden fills the whole viewport. Interface chrome stays compact and dark so the candlelight carries the warmth. A thin header holds the brand, the six page links and the wallet control. A short intro sits in a translucent block, and a bottom dock holds the main action. Information pages open as one collapsible panel over the garden: a right drawer on desktop, a bottom sheet on phones. There is no purple, there are no generic SaaS cards, and nothing is pasted over a screenshot.

## Colors

Primitives (`:root`) are referenced only by the semantic tokens below.

| Primitive | Value | Semantic role(s) |
| --- | --- | --- |
| `--night-950` | `#040a08` | `--color-bg`, header base (82% alpha) |
| `--night-900` | `#07130e` | panel surface, inputs, segmented buttons |
| `--night-800` | `#0c1f17` | `--color-surface-raised`, summary tiles, list rows, wish quote |
| `--night-700` | `#143024` | `--color-surface-hover`, pressed state, notice |
| `--emerald-500` | `#2f7d5a` | `--color-live` (sales-open dot) |
| `--gold-300` | `#f6d98f` | `--color-accent-strong` (links, hover of primary), fixture label |
| `--gold-400` | `#f2c35f` | `--color-accent` (primary action, selected outline) |
| `--ivory-100` | `#f4eedc` | `--color-text`, focus ring |
| `--ivory-300` | `#cfc6ad` | `--color-text-secondary` |
| `--coral-300` | `#ffab94` | `--color-danger`, closed-sales dot |
| `#1d1406` | | `--color-on-accent` (text on gold) |
| gold at 28% / 55% alpha | | `--color-border`, `--color-border-strong` |

Garden palette (canvas): ground `#040b08`→`#07140f`→`#0c2118` (darker in the distance), canopy `#0a1d15`, hedges `#0b2219`, terraces `#11231a` / `#13261d` with gold edges at 10–24% alpha (stronger up close), stream `#1a3a3a`→`#0d2a2b` with moonlit shimmer at 16% alpha, moon glow `rgba(190,214,220,0.16)` behind the far gate, and a near-edge vignette to 38% black. Candlelight is an additive radial sprite (`rgba(255,200,110,0.9)` → transparent) at 22% alpha and 80-unit radius per candle, so it stays local. Each style has its own flame tint.

Contrast was measured by the design probe on the rendered first screen at 320, 390 and 1440 wide. All text passed WCAG AA.

## Typography

- Headings: `--font-serif` = Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif. Weight 600, line-height 1.15, `text-wrap: balance`.
- Body and controls: `--font-sans` = system-ui stack. Weights 400, 600 (labels) and 650 (primary button).
- One scale of six sizes: `--text-sm` 13px, `--text-base` 15px, `--text-md` 17px, `--text-lg` 20px, `--text-xl` 28px, `--text-2xl` 40px. h1 = 40px (28px under 640px), h2 = 28px (20px under 640px), h3 = 20px.
- Numbers use `font-variant-numeric: tabular-nums`. Text fields use at least 16px so iOS does not zoom.
- No all-caps labels, no letter-spacing, no eyebrow kickers. No web fonts are bundled.

## Layout

- Spacing scale: 4, 8, 12, 16, 24, 32px (`--space-1`…`--space-6`).
- Header: fixed, 56px tall. Page links are inline above 1100px; below that a 44px menu icon button opens a stacked list with 48px rows. At 480px and below the wordmark text hides and the 44px favicon link (named "Everlight Garden, home") stays, so the menu and the full wallet label ("Connect" or "Switch to Ethereum") fit at 320px. The switch-error note drops below the header as a small floating card.
- Garden: fixed full-viewport canvas. The overlay above it lets pointer events through, except on its children.
- Garden scene (`web/src/garden/layout.ts`, `drawSectorArt` in `renderer.ts`): each 1200×900 sector is one view down a candle path that recedes to a small moonlit arch at the top centre. A tapered stream with stepping stones runs down the middle. Six terraces line it on both banks, holding 8, 12, 14, 18, 20 and 24 candles from far to near (96 per sector). Terrace baselines sit at `0.24 + 0.66·d^1.45` of the sector height, so rows bunch up in the distance. Candles, holders, glows and rings scale by `0.5 + 0.7·d^1.2` (0.5 far, 1.2 near). Terraces widen from ±160 to ±580 units. Large arches straddle each sector's side edges, so neighbouring sectors complete them, and two large frog sculptures frame the near corners. Small frogs and the flowers are scaled to their depth. A candle's place still depends only on its position, so it is the same after a reload.
- Intro: top-left, max 440px. Under 640px it spans the width with 12px side insets.
- Dock: bottom-centre on desktop. Under 640px it is full width with "Light a candle" and "My candles" in one row and the find field below. It hides while a panel is open on phones.
- Panel: right drawer `min(440px, 100vw)` on desktop. Under 640px it is a bottom sheet at 78% height with rounded top corners.
- Map tools: minimap 160×110 (112×77 under 640px) and a zoom column, bottom-right above the dock.
- Candle details: bottom-left card up to 400px wide. On phones it spans the width above the dock.
- Checked for no horizontal overflow at 320, 390 and 1440, and on every panel at 390.

## Elevation & depth

Depth comes from translucency and borders, never from shadows. No surface combines a border with a shadow. Overlays use the night ramp: base → 800 → 700 for hover and pressed. The connect sheet has a 60% black backdrop.

## Shapes

Radii: 8px for controls, tiles and rows, 12px for menus and toasts, 16px for the intro, dock, panel sheet, detail and connect sheet. Accent borders are a 3px left rule on notices, burn stages and wish quotes.

## Components

- **Primary button `.cta`**: gold fill with dark text, 44px minimum height. Hover lightens to `--gold-300`, pressed scales to 0.96, disabled is 60% opacity. `.cta.ghost` is the connected-address variant and `.cta.wide` is full width.
- **Secondary button `.btn`** and **icon button `.icon-btn`**: night surface with a gold hairline border. Hover and pressed states use the night ramp. 44px targets.
- **Close `.x`**: a 44px square with ×, always labelled.
- **Segmented control `.seg`**: quantity presets 1, 5 and 10, a custom field (1–50), and the "Same for all" / "One per candle" choice. Uses `aria-pressed`.
- **Style picker `.styles`**: a radio group of the seven candle sprites. The selected option has a gold border, and keyboard focus draws the ring around the tile.
- **Wish field**: a textarea with a live counter (`n/280 characters · n/1120 bytes`) that turns coral, with a fix-it sentence, when over a limit. It is linked through `aria-describedby`.
- **Summary tiles `.summary`**: label/value pairs in two columns, one under 640px.
- **Burn stages `.stages`**: an ordered list (Allocated → Queued → Reserved in jobs → Dispatched → Burned on Base → Confirmed on Ethereum), each with a value and a sentence saying whether it is burned yet.
- **List row `.row`**: 48px, number and then text, with an ellipsis for long wishes. Used for My candles, the register, activity and wallet rows.
- **Connect sheet**: a dialog with EIP-6963 wallets by name and icon, then Coinbase Wallet. On phones it shows "Open in MetaMask / Coinbase Wallet / Rabby / Phantom" and Coinbase Smart Wallet. It is portalled to `<body>`; while open, `#root` is `inert` and Tab / Shift+Tab cycle inside the sheet. It closes with the backdrop, Escape or ×, and returns focus to Connect. When connected it shows the short address and a Disconnect item; on the wrong chain, "Switch to Ethereum".
- **Toasts**: a live region for transactions recovered after a reload.
- **Find**: the numeric field in the dock. An ID up to the onchain total that has not streamed in yet is read with `getCandle`, showing "Loading candle #N…" while it loads. If that read fails it says "Candle #N could not be loaded. Try again." Only IDs above the onchain total get "does not exist yet".
- **Gas estimate**: the summary shows "Reading…" or "Unavailable" until a current gas price exists. A failed read adds a "Retry gas estimate" button, and approval stays disabled until there is an estimate.
- **Unavailable values**: any treasury figure whose read failed shows "Unavailable", never 0. An alert offers Try again.
- **Garden canvas**: focusable. Arrows pan, +/− zoom, drag pans, pinch and wheel zoom, and clicking a candle opens details. Empty holders are stone dishes without flame. Lit candles show a sprite, an animated flame (LOD 2) and a local glow. The selected candle gets an ivory ring and "my" candles get gold rings.

## Responsive behaviour

| Width | Behaviour |
| --- | --- |
| > 1100px | inline nav, right drawer, centred dock |
| 641–1100px | menu icon with stacked nav, right drawer |
| ≤ 640px | smaller h1/h2, full-width intro and dock, bottom-sheet panel and connect sheet, smaller minimap, single-column summaries |
| ≤ 480px | wordmark text hidden (the favicon link remains), 12px padding on the header buttons |

Reduced motion: CSS transitions drop to 0.01ms, and the canvas stops flame animation and redraws only on interaction (0 frames drawn while idle, measured).

## Do's and don'ts

- Do keep the garden dark: add light per candle, never a global brightness.
- Do label queued and reserved burn amounts as not burned.
- Don't add shadows to bordered surfaces, all-caps kickers, or a seventh font size.
- Don't render wish text as HTML.
