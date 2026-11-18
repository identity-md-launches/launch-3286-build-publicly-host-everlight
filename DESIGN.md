# Everlight Garden design system

Taken from the final source: `web/src/styles.css` (base tokens, then the "Reference restyle (v2)" block, which overrides them), `web/src/garden/renderer.ts`, `web/src/garden/scenery.ts`, `web/art-src/paint.js` and the components in `web/src/`.

## Overview

A nocturnal fantasy garden fills the viewport. It is **one world** drawn by one camera (`web/src/garden/renderer.ts`):

- **Distance (the only parallax layer):** a procedural vista (`web/src/garden/vista.ts`, drawn once into a 2400×760 offscreen canvas): emerald-black sky, stars, a haloed moon, moonlit cloud banks, three ridges of wooded hills with sparse far candle terraces and aqueduct arches, and a spired castle with lit windows. Its foot sits on the world skyline `horizonY(x)`. It scales with zoom but never grows taller than the visible sky band, and it drifts at 0.12× the pan, so the castle stays right of centre at the opening view.
- **Land:** one world-aligned ground texture filled from the skyline down to the bottom of the view, so no edge of the world is a void.
- **Garden and wild cells:** the world is a grid of 1200×900 cells. Cells inside the garden (`sectorAt(gx, gy) < sectorCount`) are cultivated: curved terraces, stone holders, gazebo, bridge lanterns, brass frogs. Every other cell is the same ground, stream, path, pools, waterfalls and bridges drawn as dense old woodland (`drawSectorArt(…, wild = true)`). The garden therefore grows into scenery that already joins it, and streams and paths run continuously everywhere.
- **Candles:** drawn per row after that row's cells, so trees and walls of nearer rows occlude them correctly.

The interface is compact antique-gold chrome on near-black emerald: a slim header with the brand, four tabs and Connect wallet; a serif italic headline at the top left; small side actions on the right; a bottom strip with Find my candle, the minimap and the contract's economics; round zoom / zoom-out / reset buttons at the bottom left. There is no purple, no dashboard cards, no screen-fixed scenery and no reference pixels.

## Layers (render order)

| # | Layer | Source | Notes |
| --- | --- | --- | --- |
| 1 | Vista | `makeVista()` in `vista.ts`, drawn by `drawVista()` in screen space | the only parallax layer; foot on the world skyline; scale `min(zoom-based, (skylineY − 30) / (760 × 0.78))`; tiles horizontally |
| 2 | Land and skyline haze | `drawLand()`: `ground.webp` darkened once, one world-aligned pattern below `horizonY(x)`, then one moonlit haze gradient over the far edge (world y 70–360) | one pass in world space: no band, no per-sector seam |
| 3 | Flat cell layers, every visible cell | `cell()` caches `drawSectorBase()` on a canvas of exactly the cell plus 4 units (`BASE_PAD`): tonal patches and ground cover kept wholly inside the cell, the row's path, the column's stream (from its spring in the home row), the pools of this cell and its north/south neighbours, the founding entrance walk | each cell paints the same world-space curves clipped to itself, so no cell covers a neighbour's path or water and joins have no step or cut |
| 4 | Upright cell layers, back to front by row | `drawSectorUpright()` on the cell plus a 180 margin: terraces, holders, trees, bushes, gazebo, bridge, frogs, home-row tree line; whole sprites only | then that row's candles, so nearer trees and walls occlude them; after row 0, `drawMist()` lays the skyline mist once in world space. Detail tiers 0.125× / 0.35× / 0.7× / 1.0× (LRU 600 / 60 / 20 / 8 cells), at most 6 cost units built per frame |
| 5 | Candle light | additive glow per lit candle: halo radius 80k at 30%, ground pool 92k×34k at 28% | drawn after its row's cells; flicker only without reduced motion |
| 6 | Purchased candles | `drawCandle()`: style sprite at 0.5k; flame is one pre-rendered sprite per style (`makeFlame()`) at 1.5k, swayed by a skew and stretched vertically | from contract data only; never pre-lit |
| 7 | Rings | selected candle (ivory) and My candles (gold) | |
| 8 | UI | header, intro, side actions, strip, map tools, panels, popup, sheets | HTML, keyboard reachable |

Brass lanterns at garden bridge heads and the castle windows are steady boxed lights; only purchased candles have flames. Wild cells have no lanterns.

## Colors

Primitives:

| Token | Value | Role |
| --- | --- | --- |
| `--night-950` | `#040a08` | `--color-bg` |
| `--night-900` | `#07130e` | inputs, segmented buttons |
| `--night-800` | `#0c1f17` | `--color-surface-raised`, rows, tiles |
| `--night-700` | `#143024` | `--color-surface-hover` |
| `--emerald-500` | `#2f7d5a` | `--color-live` |
| `--emerald-700` | `#0f3a27` | active tab (gradient from `#145236`) |
| `--emerald-800` | `#0a2a1c` | side-action hover, notice |
| `--gold-300` | `#f6d98f` | `--color-accent-strong`, CTA hover |
| `--gold-400` | `#f2c35f` | `--color-accent`, icons |
| `--gold-500` | `#d4a84c` | CTA gradient foot, wish rule |
| `--ivory-100` | `#f4eedc` | `--color-text`, focus ring |
| `--ivory-300` | `#cfc6ad` | `--color-text-secondary` |
| `--coral-300` | `#ffab94` | `--color-danger` |

Semantic additions (v2):

| Token | Value |
| --- | --- |
| `--color-headline` | `#f3dca0` (brand, h1, panel headings, popup title) |
| `--color-line` | `rgb(212 168 76 / 0.6)`: slim gold borders on the header, strip, side actions, popup, panels and sheets |
| `--color-line-soft` | gold at 30%: dividers, inputs |
| `--color-chrome` | `rgb(4 9 7 / 0.9)`: floating sheets |

Chrome surfaces use vertical gradients from `#0a1811`/`rgb(10 22 15)` to `#050c08`/`rgb(4 9 7)`. The primary CTA is a gold gradient (`#f3d07a` → `--gold-500`) with `--color-on-accent` `#1d1406` text.

Scene palette (from `vista.ts`, `paint.js`, `scenery.ts`):

- **Sky (vista):** `#030807` (`VISTA_TOP`) → `#071512` → `#0d2422` → `#0c1f1a`; land foot `#07130d` (`VISTA_FOOT`).
- **Moon:** `#fbf8ec` → `#bfc2b4` with a `rgba(200,225,215,0.28)` halo.
- **Ridges:** far `#0c1d1e`, middle `#0a1a15`, near `#08160f`; castle `#0a1718` with `#ffd98f` windows; mist `rgba(110,150,150,≤0.12)`.
- **Foliage:** dark `#06140d`–`#0c2617`, lit `#13402a`–`#226443`, moon rim `#4f8a6c`.
- **Water:** `#28506a` → `#0a2430`, with shimmer `rgba(190,225,245,0.22)`.
- **Stone:** `#3d3a30` plus noise, gold coping `rgba(214,186,120,0.22–0.42)`.
- **Brass:** `#fff0b8` → `#e2b45a` → `#9a6a24` → `#21160a`.
- **Flowers:** `#f7f4ea` with `#d6a73c` centres.
- **Candle glow:** `rgba(255,200,110,0.9)` → transparent.

Contrast: the design probe measured all first-screen text at 320, 390 and 1440 wide, and everything passed (≥4.5:1, or ≥3:1 for large text). The intro sits on a radial scrim `rgb(3 8 6 / 0.82)`.

## Typography

- Serif (`--font-serif`: Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia): brand, h1–h3, nav tabs, buttons, side actions, percentages.
- Sans (`--font-sans`: the system-ui stack): body, labels, economics captions.
- Weights: 400 and 600 only. The h1 is 400 italic. Headings, the brand and the CTA are 600.
- One scale of six sizes: 13 / 15 / 17 / 20 / 28 / 40 px (`--text-sm`…`--text-2xl`). The h1 is 40px (28px under 640px), the brand 20px, the tabs 17px, the percentages 20px (17px under 1500px).
- The brand is uppercase with 0.03em tracking, inside the probe's 0.04em bar. There are no eyebrow labels. Numbers are tabular.

## Spacing, shape, elevation

- Spacing scale: 4, 8, 12, 16, 24, 32px (`--space-1…6`).
- Header height 56px. Strip height 76px (64px under 900px).
- Radii: 8px for controls, 10px for side actions, the popup and the minimap, 6px for tabs, 16px for sheets, and 50% for the zoom buttons.
- Depth comes from the scene layers and the gold hairlines. There are no border-plus-shadow combinations. Text shadows sit only on text that overlays the scene.

## Components

- **Header** (`.top`): the brand (favicon and "Everlight Garden · on IMD"; under 480px the name stays, set on two lines at 17px, and only " · on IMD" drops). The four tabs Garden / My Candles / Rewards / Treasury sit between gold hairline dividers, and the active tab is emerald with a gold border. The wallet button (`ConnectSheet`) is on the right: "Connect wallet" from 600px, "Connect" below 600px, with `aria-label="Connect wallet"` at every width. Under 1100px the tabs move into a menu button; the menu lists all six routes.
- **Intro** (`.intro`): the h1 "Light a wish in the garden" with a centred gold rule, one plain line, a sales-status line with a live dot, and the fixture label when a fixture is active. Under 900px it also shows the primary CTA "Light a candle · 1 IMD".
- **Side actions** (`.side`, desktop ≥900px): Light a candle · 1 IMD (non-breaking spaces keep "1 IMD" together and the dot with "candle"), My rewards and How it works. Each is a 96px gold-bordered tile.
- **Bottom strip** (`.strip`):
  - Find my candle: a crosshair icon, a numeric input and a button. It searches any id, including ids not loaded yet.
  - A slot for the minimap (220×72 canvas, click to move).
  - The economics as a `<details>` list: 30% Burn, 30% Previous paid candles, 30% Ecosystem, 5% Operations, 5% Founder. It is open on desktop and collapsed to a "Split of 1 IMD" sheet under 900px; its open state is tracked (`splitOpen` in `App.tsx`) and, under 900px, opening it hides the map tools so all five rows stay readable and tappable.
- **Map tools** (`.map-tools`): round + / − / reset-view buttons at the left above the strip, and the minimap. The minimap draws the actual world: sky, wild woodland, garden cells, every stream, lit candles, the selected candle and the camera rectangle; click moves the camera. The whole group carries `hidden` whenever a panel or the menu is open, and on screens under 900px while a candle sheet or the split sheet is open, so it never sits over an input, wish, price, validation message or primary action. Keyboard: arrows pan, + / − zoom, 0 resets.
- **Camera bounds** (`clamp()`): zoom from the level where the whole garden plus a 900-unit ring of woodland fits, up to `MAX_ZOOM` = 1.8× (the 1.0× cache tier keeps scenery at most 1.8× stretched); the view centre stays over land and the skyline never drops below 45% of the screen.
- **Candle popup** (`.detail-wrap.anchored`): 320px, with a pointer notch. `placePopup()` (`web/src/lib/popup.ts`) puts it above the flame when it fits between the header and the strip, otherwise below the flame (`.below`, notch on top), preferring the side that keeps clear of the intro; if it still overlaps the intro, the intro is hidden (`.intro-yield`) so text never sits over text. On desktop it always uses this anchored placement: it is hidden while its flame is under the header or the strip or off the map, keeps the selection, and returns beside the flame when the candle comes back into view (it is never shown detached). It shows the id, owner (explorer link), style, date, position, the transaction that lit it (`useCandleTx()`: Etherscan `/tx/` link, "Looking up…", or "Transaction unavailable"), the public wish (italic serif, rendered as text), the full owner address with a Copy address button, and links to the contract read (`getCandle`), the owner on Etherscan and the owner's garden transactions. It stays anchored to the flame while the map pans and zooms. Under 900px it becomes a sheet above the strip whose height is capped (`max-height: min(60vh, max(176px, 100dvh − header − strip − 230px))`, scrolling inside) so a selected candle always has room above it. Escape or × closes it.
- **Quantity** (Light panel): presets 1 / 5 / 10 and a Custom text field (`inputMode="numeric"`). `parseQuantity()` accepts only whole numbers 1–50 and never clamps or rounds; anything else sets `aria-invalid`, shows the reason under the field, blanks Candles / Total / Approval and disables the action ("Enter 1 to 50 candles"). The draft (quantity, styles, wishes) is kept in `sessionStorage` through wallet and network errors, reloads and route changes, and cleared only after a confirmed purchase: a mined receipt (following sped-up or cancelled replacements) that carries the garden's own `CandlesPurchased` event for this buyer and quantity. A replacement without that event is reported as cancelled and keeps the draft.
- **Purchase lock** (`.draft-lock`, `.pending-box`): one shared purchase state (`purchaseFlow` in `lib/purchase.ts`) survives remounts and reloads. While a sent purchase has no settled receipt, the draft's fieldset is disabled (72% opacity), the action is disabled and the form shows the pending transaction link; if the receipt cannot be read the form offers Check again and "Forget it: my wallet shows it was dropped". The explorer link stored for each candle is the mined transaction's hash.
- **Connect inside panels:** Light, My Candles and Rewards show a Connect wallet button that opens the one header connect sheet.
- **Panels** (`.panel`): Light a candle, My Candles, Rewards, Treasury and How it works. They open as a right drawer above the strip on desktop and as a 78% bottom sheet on phones. Escape returns to the garden, and focus moves to the panel on open.
- **Sheets, menus, toasts:** gold hairline, emerald-black gradient.
- **Controls:** each has rest, hover, pressed (scale 0.96–0.98), 2px ivory `:focus-visible` ring and disabled (60% opacity) states. Transitions are 150ms on named properties only.

## Responsive behaviour

| Width | Behaviour |
| --- | --- |
| ≥1500 | full strip, 20px percentages |
| 1100–1500 | tighter economics (17px, 8px padding) |
| <1100 | tabs collapse into the menu button; the "on IMD" suffix is hidden |
| <900 | side actions hidden and the intro CTA shown; minimap 132×44 above the strip at right; zoom / reset row at left; economics become a collapsible sheet; the popup becomes a sheet, the map tools and the intro hide behind it |
| <900 (Find) | after the candle sheet renders, Find measures it and the header and centres the candle and its whole ring in the band between them, zooming out if the band is short |
| <640 | the intro starts 40px below the header (keeps Connect from reading as an eyebrow); panels become bottom sheets; the strip hides under an open panel |
| <600 | the wallet button reads "Connect" (accessible name "Connect wallet") |
| <480 | the wordmark stays: mark plus "Everlight Garden" on two lines at 17px; " · on IMD" hidden |

At 390 wide the first screen shows the garden, the headline and the "Light a candle · 1 IMD" action (see `artifacts/screens/m390-live.jpg` and `m390-f100-home.jpg`). Touch: drag pans, pinch zooms and tap opens a candle. Keyboard: arrows pan, + and − zoom, Find opens any id, and the register lists every candle. `prefers-reduced-motion` stops the flame flicker and the CSS transitions.

## Garden geometry (continuous landscape)

`layout.ts` lays the garden out as one landscape seen from a raised three-quarter view. Sectors (1200×900 world units, 96 holders) are bookkeeping only; they grow in U-shaped half-rings from the founding sector (`spiral()`, inverted in closed form by `sectorAt()`, with no cap), never north of the home row, so the vista always sits behind the garden's northern edge.

- **Streams** wind north-south (`streamX(gx, y)`): each sector edge has a seeded crossing point shared by both sectors on it, joined by a smoothstep plus a seeded sin² bend, so the curve is continuous and smooth across edges.
- **Paths** wind east-west the same way (`pathY(gy, x)`) and cross each stream on a bridge rotated to the path slope.
- **Terraces** are curved ledges: arcs of ellipses with `TILT` = 0.42 (circles on the tilted ground plane), with seeded centre, radius (90–260), arc length, wall height and candle scale (about 0.8–1.0). They are fitted around the stream, path, pools, waterfall and gazebo by seeded rejection sampling (`sectorPlan()`), so no two sectors share a layout and nothing sits on a rectangular grid.
- **Founding pedestal**: slot 0 (candle #1) stands at 2.1× scale on a round plinth at the head of a broad entrance walk; the opening view and Reset view (`home()`, zoom `w / 2000` clamped to 0.5–1.1, 0.62 on phones) put the skyline about a third of the way down with the vista above it.
- **Skyline**: `horizonY(x)` in `layout.ts` is shared by the land fill and the row-0 scenery tree line.
- **Springs**: in the home row each stream starts at `springY(gx)`, 95 units below the skyline at the stream's x, in a small pool under a cluster of mossy boulders with a short cascade; the stream widens from 30% over its first 140 units. The column's sector waterfall moves at least 150 units downstream of the spring and is left out where that would put it on the bridge.

Positions depend only on a candle's position (id − 1), so they are stable across reloads and new purchases. Slot positions (`sectorPlan`, `positionOf`) are unchanged from the previous round; this round changed only how scenery is drawn around them. Hit testing searches the 3×3 sector neighbourhood around the pointer, using the candle body 42 units above the slot. LOD: below 0.3× zoom, cached low-resolution sector images with cached per-sector light layers; from 0.3×, sprites; from 0.7×, animated flames.

## Revision 4 additions (implemented in `web/src/everlight.css`, loaded after `styles.css`)

**Tokens.** `--dock-w: 380px`; brass `--brass-1 #f3d48a`, `--brass-2 #b88a35`, `--brass-3 #5c4115`; `--panel-bg` a vertical gradient `rgb(9 26 19 / .96) → rgb(4 12 8 / .97) → rgb(3 8 6 / .98)`. Existing colour, spacing and radius tokens are unchanged.

**Typography.** Headline: serif italic, `clamp(var(--text-xl), 3.2vw, 2.75rem)` (one sentence, "A wish, a flame, a place forever"); 360 px and below it drops to `--text-lg`. Form labels, legends, quantity pills, Total and Cost details use the serif at weight 400; helper text is sans `--text-sm`. No other sizes were added.

**Components.**
- *Header*: Connect wallet is outlined gold on near-black; the current page tab has a 2 px gold underline; Wrong network is a coral-bordered button opening a menu (account, Switch to Ethereum, Disconnect).
- *Light dock* (`.light-dock`, ≥1180 px): fixed right, between header and strip, 380 px, gold hairline border with an inset double frame, scrolls internally.
- *Candle preview* (`.preview`): 200 px (168 px on phones) dark emerald well with a warm radial glow, the selected style's SVG at 2× and a brass rim; a CSS flame sits on each style's wick (`--wick`) and flickers, static under reduced motion.
- *Style row*: seven equal tiles in one grid row; the selected tile has a gold border and a lighter emerald fill; names are visually hidden but remain the radio labels.
- *Quantity*: three pill buttons plus a wider Custom pill with an inline numeric input (wraps to its own row at ≤360 px).
- *Total* with gold hairlines either side; *Stages* list (dot markers: outline = to do, gold glow = now, emerald = done).
- *Primary CTA*: brass gradient, 52 px tall, 12 px radius; muted bronze when disabled.
- *Wrong-network box*: coral border, explanation plus Switch to Ethereum.
- *Candle popup*: title, the wish in serif (wraps anywhere), then the record and explorer links.

**Responsive behaviour.** ≥1180 px: form docked, quick-action column hidden, headline limited to the open area, toasts move left of the dock, castle placed in the open area. 901–1179 px: previous layout (side actions, form in a panel). ≤900 px: candle sheet above the strip (`z-index 30`, scrolls internally), map tools hidden while it is open. ≤360 px: tighter style row, Custom on its own row, smaller headline.
