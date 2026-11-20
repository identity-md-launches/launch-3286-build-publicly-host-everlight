# DESIGN: revision 13 changes (current source, 2026-11-20)

These notes supersede the revision 12 frog notes below wherever they differ. Everything else is unchanged.

## Tokens changed
- Ambient character palette (`web/src/garden/ambient.ts`, `PAL`): skin `#3f7a3c` (G), crown highlight `#5a9a44` (Z), limbs `#6aa84f` (L), eyelids and feet `#2a5233` (D), ink and pupils `#050a08`, eye whites `#f0efe6`, upper lip `#c4644c` (U), lower lip `#8a3a2c` (V), shirt `#35609a` (J) with hem shade `#25466f` (I). The props are unchanged: paper `#efe6cc`, lantern `#d79a32`/`#fff2b0`, ritual light `#7dffb0`/`#c8ffe0`. Ritual lights stay mint so they never read as purchased amber candles.
- Typography, spacing and the UI colour tokens are unchanged from the revision 12 and pixel revision sections below.

## Components changed
- **Ambient Pepes** (`frog()` in `ambient.ts`; the function name was kept so the diff stays small): an original 20x20 pixel sprite of Pepe. It has a broad face wider than tall, two large eyes bulging over the top of the head with heavy lids and pupils glancing towards the facing side, wide two-tone lips that run past the cheek, a blue shirt, and short green legs and arms. The same body is used for every pose: walk 4, idle 3, read 5 (newspaper held at chest height on a bench), lantern 4, lift 1, roll 4, curl 1, getup 1, dance 5, ritual 2 (the light is raised above the head) and rest 2. Everything is still built once into one shared atlas.
- **Path-following routes**: a waypoint is `[x, y, pauseMs, pose, pathOffset?]`. A leg between two on-path waypoints follows `pathY(x) + offset`, with offsets of ±4 for walkers and +2 for the lantern carrier, all inside the stair corridor. The length of such a leg is measured along the curve. Off-path legs to trees pass only when `walkable()` holds: every 6 world units the point must be dry and must not lie on a wall face or coping outside the path corridor.
- **Shared terrace landings** (`terraceJoins()` / `drawJoin()` in `scenery.ts`): two candle beds stacked above each other (overlapping by at least 40 world units, with a gap under 150) get one continuous lawn mass. It runs from the foot of the upper wall to the back edge of the lower bed, is shaded under the upper wall and carries moss, flowers and rocks. Three-pixel return walls close it at both ends of the overlap. The path, the stream and the stairs are left uncovered, and slot coordinates are not changed.
- **Spring outlet**: the rounded stone rim has a notch where the stream leaves (`y > basin centre` and inside the channel half-width plus 3). The basin water and the channel are therefore one connected water shape.
- **Purchase form**: the button reads "Approve exactly N IMD and light N candles" whenever an approval is needed. A purchase-only click that finds a revoked allowance shows "Allowance now: X IMD" and sends nothing. An approval that may have been sent shows the shared recovery box (Check again, Search my account's transactions, paste a hash and Match).
- **My candles**: an incomplete register shows "Incomplete: X of your Y candles were read" with Try again, and lists the IDs it did read.

## Responsive behaviour
- Unchanged: the Pepes scale with the world at the same pixel density as the scenery, are not drawn below zoom 0.34, and never take pointer input.
- The new landings are world-space terrain, so they scale and pan with the garden.

# DESIGN: revision 12 additions (current source, 2026-11-20)

The tokens, type scale and components further down still apply. This revision adds only what is listed here.

## Tokens added
- Hillside geometry (`web/src/garden/scenery.ts`): `CONTOUR_STEP = 150` world units between terrace levels, `CONTOUR_WALL = 10` (wall face height), `contourY(k, x)` for each wall's top edge (continuous across cells), `SPRING_TAPER = 320` (the stream widens from 28% to full width over this distance).
- Wall colours reuse the stone palette: lit course `#8f8b74`, face `#565648`, joints `#1e201c`, foot shadow `#0a140f`, moss coping `#3f7a3c`, flowers `#f4f1e4` / `#d98aa8`. Cascade foam `#c8f0de` over `#5aaa96`.
- Frog sprite palette (`web/src/garden/ambient.ts`, `PAL`): body `#3f7a3c`, light `#6aa84f`, legs `#2a5233`, ink `#050a08`, eye white `#f0efe6`, belly `#cdbf9c`, cheeks `#d79a32`, paper `#efe6cc`, lantern `#d79a32`/`#fff2b0`, ritual light `#7dffb0`/`#c8ffe0`. The ritual lights are mint so they never read as purchased amber candles.
- Motion: `ACTOR_FPS = 12` (`motion.ts`). Frogs are drawn only at zoom `>= ACTOR_ZOOM = 0.34` (`renderer.ts`).

## Components added
- **Ambient frogs**: 20x20 art-pixel frames in one atlas built at start (walk 4, idle 3, read 5, lantern 4, lift 1, roll 4, curl 1, getup 1, dance 5, ritual 2, rest 2). They are drawn at 1 art pixel = 2 world units, like all scenery, with a contact shadow. Each cell has a seated reader who turns pages, a lantern carrier with a soft warm glow, a roller, two walkers who rest beneath real trees, and a dancer; every third cell has a five-frog ritual circle. Depth: frogs draw after their row's scenery and before its candles and the next row, and trees in front of a frog are redrawn over it.
- **Still garden button** (map tools, 44 px icon button with `aria-pressed`): pauses frogs, water and flames. It is disabled, with a title explaining why, when the OS already requests reduced motion.
- **IntentRecovery**: Check again, Search my account's transactions, and paste-a-hash Match. There is no Release control.

## Responsive behaviour added
- Frogs scale with the world, at the same pixel density as candles and trees. At phone zoom (0.42 to 0.62) they stay visible; below 0.34 they are not drawn. Touch pan and pinch-zoom are unchanged, and a tap on a frog does nothing.
- Animation pauses when the garden scrolls out of view (IntersectionObserver), in hidden tabs, and in reduced-motion or still mode.

---

# DESIGN: Everlight Garden, 16-bit pixel revision (current, 2026-11-19)

This section describes the implemented source after the pixel redesign. It supersedes the earlier sections
below wherever they conflict (those describe the retired painted look and are kept for history).

## Tokens (`web/src/pixel.css`, loaded last over `styles.css` / `everlight.css`)
| Token | Value | Use |
| --- | --- | --- |
| `--px-black` | #050a08 | page background, sprite keylines |
| `--px-emerald-950/900/800` | #0b1712 / #12251b / #1c3a26 | surfaces, raised surfaces, hover |
| `--px-green-600/500/400/300` | #2a5233 / #3f7a3c / #6aa84f / #a7d36a | primary button fill (600; hover #356a3f, inset shadow #1c3824), frames and lines (500), accent (400), active nav and button rim (300) |
| `--px-ivory`, `--px-ivory-dim` | #efe6cc / #cdbf9c | body text, secondary text |
| `--px-gold`, `--px-gold-deep` | #f5c95a / #d79a32 | flames, IMD totals, focus ring |
| `--radius-*` | 0 | everything is square |
| `--px-frame` | 2px black keyline + 2px green rim + faint inner rim | panels, dock, sheets, minimap, preview |
Type: unchanged single scale of six sizes (`--text-sm` 13 to `--text-2xl` 40px); serif stack for headings and
controls, system sans for body. Focus: 3px gold outline, 2px offset, on every focusable element.

## Pixel art system
- One density: 1 art pixel = 2 world units (`PX` in `web/src/garden/scenery.ts`). Cells are painted at art
  resolution and scaled with nearest-neighbour sampling; far views use cached 1/2 and 1/4 reductions.
- Palette and all sprites: `web/art-src/pixel/build.mjs` -> `web/public/art/px/*.png` (CC0, `px/LICENSE.md`).
- Ground is sampled per pixel from 16x16 tiles (grass x2 with ordered dither, flagstone path, mossy bank,
  water); terraces are pixel columns of wall tile with moss coping and hanging moss; bridges are drawn per
  pixel column with an arch opening; props are sprites at whole art-pixel positions, depth sorted.
- Vista (`vista.ts`): banded dithered sky, stars, pixel moon, three ridges with terraces and aqueduct arches,
  one castle; painted at 1/4 resolution and drawn with smoothing off.
- Candles: unlit holders are part of the cached scenery for all 10,080 slots of the empty garden. Only
  confirmed candles draw a style sprite (7 styles), one of four flame frames (frame 0 when motion is reduced
  or far away), a stepped gold halo and a ground glow pool. Overview LOD uses one cached light layer per
  sector. A warm screen lift grows with log10(lit count). Decorative lamps are green glass, never gold.
- Water: drifting pixel ripples along every stream in view, on their own clock (`web/src/garden/motion.ts`). They run at
  20 fps whenever a stream is on screen at zoom >= 0.3, with or without candles. Flames run at 30 fps at zoom >= 0.7 when
  candles exist. Nothing animates in a hidden tab (`document.hidden`) or with `prefers-reduced-motion`. Dirty frames
  (pan, zoom, new data) draw at once.
- Terraces and paths: every raised terrace tries to carry a flight of steps at one end of its retaining wall. The first
  choice is an end facing the viewer just past the last holder. Failing that, ends further round the wall, or one more
  step clear, with a narrower flight if needed. A flight whose foot lands on the row's path joins it directly. Otherwise
  a flagstone walk leads to the path: straight, longer, or two-leg (L-shaped). If no walk reaches the path, the walk
  goes to the foot of a neighbouring flight that is already connected (`stairsOf` + `connect` in `scenery.ts`). Walks
  keep off holders, water and other terraces. Decoration keeps off every walk leg.
- Ground-level beds (revision 8): a terrace with no flight that connects to the path is drawn without a raised wall. It
  gets a lawn band with a 2-art-pixel stone kerb (`wall-tile`), mossy coping and no hanging moss
  (`drawTerrace(…, flush)` in `scenery.ts`). Its holders keep their coordinates and are reached from the ground. Every
  terrace still drawn raised has a connected flight.

## Components
Header, garden canvas, right purchase dock, minimap/zoom/Find cluster, allocation strip, sheets and modals keep
their structure from the previous revision (below); this revision restyles them with the tokens above.
- **Split purchase plan** (`.split-plan`, `everlight.css`). It appears under Total when a draft needs more than one
  transaction. A short explanation sits above an ordered list, one row per purchase: "Purchase N: candles a-b" on the
  left, IMD and gas bound (plus ETH when the gas price is known) on the right. The next purchase has a 3px gold left
  rule. The rows wrap at narrow widths. The primary button names the next purchase ("Light 30 candles (purchase 1 of 2)").
- **Candle register states** (`Register`, `Panels.tsx`). "Reading the candle register…" while the total is unknown. An
  alert "Unavailable … Try again" when it could not be read. "Showing N of M candles" for a partial list. The empty-garden
  sentence appears only after a verified total of 0. With a known total and no loaded rows: "Showing 0 of M candles,
  loading the first page…" (`.fine`, `role="status"`), or after a failure "Showing 0 of M candles. The first page could
  not be loaded." with Try again (`.bad`, `role="alert"`).
- **Re-planned purchase** (revision 8). When the contract's estimate shows fewer candles fit, the split plan gains a line
  "Re-planned from the contract's own estimate: purchase 1 is now N candles, estimated G gas (about E ETH)". The error
  line above the button says nothing was sent and every wish is kept.
- **Pending claim** (revision 8). It reuses `.pending-box` / `.pending-acts` from the purchase lock: a status line with
  the pending claim link, a Check again button (`.btn`) and a Forget link (`.link`). The Claim button (`.cta.wide`)
  reads "Waiting for the earlier claim" and is disabled. The
purchase preview is now a pixel composition (arch, hero pedestal, chosen candle sprite, 4 flame frames at 3x)
in `LightPanel.tsx` `CandlePreview`. Style picker and My Candles use the pixel candle sprites (`img.px`,
`image-rendering: pixelated`).

## Responsive behaviour
Unchanged breakpoints: at 900px and below the dock becomes a dismissible bottom sheet with a persistent
"Light a candle" action; the garden stays full-bleed and pannable at every width. Under 640px the opening camera
(`renderer.ts` `home()`) widens from zoom 0.62 down to no less than 0.42, just enough to keep the nearest stream in
frame to the right of the founding pedestal, so moving water is visible on the first screen.

---

# Everlight Garden design system

Taken from the final source: `web/src/styles.css` (base tokens, then the "Reference restyle (v2)" block, which overrides them), `web/src/garden/renderer.ts`, `web/src/garden/scenery.ts`, `web/art-src/paint.js` and the components in `web/src/`.

## Overview

A nocturnal fantasy garden fills the viewport. It is **one world** drawn by one camera (`web/src/garden/renderer.ts`):

- **Distance (the only parallax layer):** a procedural vista (`web/src/garden/vista.ts`, drawn once into a 2400×760 offscreen canvas): emerald-black sky, stars, a haloed moon, moonlit cloud banks, three ridges of wooded hills with sparse far candle terraces and aqueduct arches, and a spired castle with lit windows. Its foot sits on the world skyline `horizonY(x)`. It scales with zoom but never grows taller than the visible sky band, and it drifts at 0.12× the pan, so the castle stays right of centre at the opening view. The moon is a separate sprite (`vista.moon`, core radius 11 art px, drawn just before the castle) placed by `Renderer.drawMoon()` (`web/src/garden/renderer.ts`): its default spot is upper left of the castle (`MOON_AT` 0.36/0.30 of the castle image), and it tries, in order, that spot, the same spot moved below the header, above the headline, right of the headline, right of the castle, then a smaller moon between header and headline. The first spot that clears the header, the headline text box, the castle keep and inner towers (`CASTLE_BOXES`) and the docked panel wins; if none does, it is left out rather than drawn under chrome or text. The castle centre sits at 0.70 of the open width.
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

- **Header** (`.top`): the brand (favicon and "Everlight Garden on IMD", no separator, as in the reference; under 480px the name stays, set on two lines at 17px, and only " on IMD" drops). The four tabs Garden / My Candles / Rewards / Treasury sit between gold hairline dividers, and the active tab is emerald with a gold border. The wallet button (`ConnectSheet`) is on the right: "Connect wallet" from 600px, "Connect" below 600px, with `aria-label="Connect wallet"` at every width. Under 1280px the tabs move into a menu button; the menu lists all six routes. From 1280 to 1439px the tabs keep one line with 12px padding.
- **Intro** (`.intro`): the h1 "Light a wish in the garden" with a centred gold rule, one plain line, a sales-status line with a live dot, and the fixture label when a fixture is active. Under 900px it also shows the primary CTA "Light a candle · 1 IMD".
- **Side actions** (`.side`, desktop ≥900px): Light a candle · 1 IMD (non-breaking spaces keep "1 IMD" together and the dot with "candle"), My rewards and How it works. Each is a 96px gold-bordered tile.
- **Bottom strip** (`.strip`):
  - Find my candle: a crosshair icon, a numeric input and a button. It searches any id, including ids not loaded yet.
  - A slot for the minimap (220×72 canvas, click to move).
  - The economics as a `<details>` list: 30% Burn, 60% Previous paid candles, 5% Operations, 5% Founder, plus a note that the first-ever candle sends 90% to burn (no ecosystem row). It is open on desktop and collapsed to a "Split of 1 IMD" sheet under 900px; its open state is tracked (`splitOpen` in `App.tsx`) and, under 900px, opening it hides the map tools so all five rows stay readable and tappable.
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
| 1280–1439 | header tabs at 12px padding, 12px header gap, one line |
| 1280–1500 | tighter economics (17px, 8px padding) |
| <1280 | tabs collapse into the menu button; the "on IMD" suffix is hidden |
| <900 | side actions hidden and the intro CTA shown; minimap 132×44 above the strip at right; zoom / reset row at left; economics become a collapsible sheet; the popup becomes a sheet, the map tools and the intro hide behind it |
| <900 (Find) | after the candle sheet renders, Find measures it and the header and centres the candle and its whole ring in the band between them, zooming out if the band is short |
| <640 | the intro starts 40px below the header (keeps Connect from reading as an eyebrow); panels become bottom sheets; the strip hides under an open panel |
| <600 | the wallet button reads "Connect" (accessible name "Connect wallet") |
| <480 | the wordmark stays: mark plus "Everlight Garden" on two lines at 17px; " on IMD" hidden |
| ≤360 | header gaps 8px, menu button fixed 44×44, "Wrong network" wraps to two lines in 80px (13px) |

At 390 wide the first screen shows the garden, the headline and the "Light a candle · 1 IMD" action (see `artifacts/screens/m390-live.jpg` and `m390-f100-home.jpg`). Touch: drag pans, pinch zooms and tap opens a candle. Keyboard: arrows pan, + and − zoom, Find opens any id, and the register lists every candle. `prefers-reduced-motion` stops the flame flicker and the CSS transitions.

## Garden geometry (continuous landscape)

`layout.ts` lays the garden out as one landscape seen from a raised three-quarter view. Sectors (1200×900 world units, 96 holders) are bookkeeping only; they grow in U-shaped half-rings from the founding sector (`spiral()`, inverted in closed form by `sectorAt()`, with no cap), never north of the home row, so the vista always sits behind the garden's northern edge.

- **Streams** wind north-south (`streamX(gx, y)`): each sector edge has a seeded crossing point shared by both sectors on it, joined by a smoothstep plus a seeded sin² bend, so the curve is continuous and smooth across edges.
- **Water** (`drawSectorBase`, `web/src/garden/scenery.ts`): nested bands give lit shallows (`#1b4a5f`), mid water and a darker channel. Both banks are darkened by reflected foliage, with a thin wet-stone highlight at the waterline. Moonlight strokes, longer silver glints and faint ripple rings are clipped to the stream. Lily pads, some flowering, sit in the shallows and are kept 24 units inside their cell so none is cut at a cell join. Every layer depends only on world y and the stream curve, so rows still join without a seam.
- **Paths** wind east-west the same way (`pathY(gy, x)`) and cross each stream on a bridge rotated to the path slope.
- **Terraces** are curved ledges: arcs of ellipses with `TILT` = 0.42 (circles on the tilted ground plane), with seeded centre, radius (90–260), arc length, wall height and candle scale (about 0.8–1.0). They are fitted around the stream, path, pools, waterfall and gazebo by seeded rejection sampling (`sectorPlan()`), so no two sectors share a layout and nothing sits on a rectangular grid.
- **Founding pedestal**: slot 0 (candle #1) stands at 2.1× scale on a round plinth at the head of a broad entrance walk; the opening view and Reset view (`home()`, zoom `w / 2000` clamped to 0.5–1.1, 0.62 on phones) put the skyline about a third of the way down with the vista above it.
- **Skyline**: `horizonY(x)` in `layout.ts` is shared by the land fill and the row-0 scenery tree line.
- **Springs**: in the home row each stream starts at `springY(gx)`, 95 units below the skyline at the stream's x, in a small pool under a cluster of mossy boulders with a short cascade; the stream widens from 30% over its first 140 units. The column's sector waterfall moves at least 150 units downstream of the spring and is left out where that would put it on the bridge.

Positions depend only on a candle's position (id − 1), so they are stable across reloads and new purchases. Slot positions (`sectorPlan`, `positionOf`) are unchanged from the previous round; this round changed only how scenery is drawn around them. Hit testing searches the 3×3 sector neighbourhood around the pointer against each candle's whole holder-to-flame segment (`CANDLE_TOP` = 84 scale units), with radius max(16 × scale, 22 CSS px); the closest candle wins. The garden always has at least `MIN_SECTORS` = 105 cultivated sectors (10,080 holders), all unlit until confirmed records fill them. LOD: below 0.3× zoom, cached low-resolution sector images with cached per-sector light layers; from 0.3×, sprites; from 0.7×, animated flames.

## Revision 4 additions (implemented in `web/src/everlight.css`, loaded after `styles.css`)

**Tokens.** `--dock-w: 380px`; brass `--brass-1 #f3d48a`, `--brass-2 #b88a35`, `--brass-3 #5c4115`; `--panel-bg` a vertical gradient `rgb(9 26 19 / .96) → rgb(4 12 8 / .97) → rgb(3 8 6 / .98)`. Existing colour, spacing and radius tokens are unchanged.

**Typography.** Headline: serif italic, `clamp(var(--text-xl), 3.2vw, 2.75rem)` (one sentence, "Every wish leaves a light.", the approved reference's own headline, five words); 360 px and below it drops to `--text-lg`. Form labels, legends, quantity pills, Total and Cost details use the serif at weight 400; helper text is sans `--text-sm`. No other sizes were added.

**Components.**
- *Header*: Connect wallet is outlined gold on near-black; the current page tab has a 2 px gold underline; Wrong network is a coral-bordered button opening a menu (account, Switch to Ethereum, Disconnect).
- *Light dock* (`.light-dock`, ≥1180 px): fixed right, between header and strip, 380 px, gold hairline border with an inset double frame, scrolls internally. It is collapsible: a 44×44 hide button (`.x panel-x dock-x`, chevron icon, `aria-label="Hide the candle panel"`, `aria-expanded="true"`) sits sticky in its top-right corner with a negative left margin, so the centred heading does not shift.
- *Dock tab* (`.dock-tab`, ≥1180 px, only while the dock is hidden): the primary `.cta` button reading "Light a candle", fixed at the right edge 16px below the header, `aria-expanded="false"`. Hide and show move focus to the other control. The state lives in `App` component state; opening `#/light` always shows the dock again. While hidden the canvas uses the full width: the renderer reads no `.light-dock` edge, so the castle and moon re-centre in the wider open area, and the headline and toasts widen (`.app.dock-collapsed`).
- *Candle preview* (`.preview`, `web/src/panels/PreviewScene.tsx`): 200 px (168 px on phones) stage in three layers. `PreviewBack` is an inline SVG (`viewBox 0 0 360 200`, `xMidYMax slice`): emerald night sky, moon, faint pavilion arches, foliage masses, a warm halo, a carved stone ledge in perspective with flagstone joints, a front face, moss and a light pool, and seeded leaf sprays with five-petal jasmine. `BowlBack` (the bowl's far rim and dark interior) sits behind the selected style's SVG candle (2×, 1.6× on phones). `BowlFront` (the near lip, an engraved band with two fillets and a running scroll, the foot, and a highlight lit from the flame) sits over the candle base. The bowl is `46 × --k` px wide, at `--ctop + 62 × --k`. The CSS flame sits on each style's wick (`--wick`) at z-index 3 and flickers; it is static under reduced motion. The whole stage is `aria-hidden` and shows no candles, counts or activity.
- *Style row*: seven equal tiles in one grid row; the selected tile has a gold border and a lighter emerald fill; names are visually hidden but remain the radio labels.
- *Quantity*: three pill buttons plus a wider Custom pill with an inline numeric input (wraps to its own row at ≤360 px).
- *Total* with gold hairlines either side; *Stages* list (dot markers: outline = to do, gold glow = now, emerald = done).
- *Primary CTA*: brass gradient, 52 px tall, 12 px radius; muted bronze when disabled.
- *Wrong-network box*: coral border, explanation plus Switch to Ethereum.
- *Candle popup*: title, the wish in serif (wraps anywhere), then the record and explorer links.

**Responsive behaviour.** ≥1180 px: form docked (collapsible to a right-edge tab), quick-action column hidden, headline limited to the open area, toasts move left of the dock, castle placed in the open area. 901–1179 px: previous layout (side actions, form in a panel). ≤900 px: candle sheet above the strip (`z-index 30`, scrolls internally), map tools hidden while it is open. ≤360 px: tighter style row, Custom on its own row, smaller headline.

## Revision 5 additions

**Components.**
- *Fixture label* (`.fixture-bar`, `web/src/everlight.css`): `--gold-300` fill, `--color-on-accent` text, `--text-sm`, 8/12px padding. It sits sticky at the top of every panel (64px right padding clears the close button) and above the docked form; on the garden the intro carries the same text (`.intro .fixture`). The wording is "Test fixture (N simulated candles), transactions disabled."
- *Candle detail*: shown only on the garden (and beside the docked form at ≥1180px). Navigating to another page closes it; focus actions return to the garden first.
- *Ignition* (canvas): unlit wax, then for the first 12% a spark at the wick growing from 0.6 to 2.2 units, then the flame scales up with an ease-out-back overshoot (about 1.05) while a bloom of up to 150 × scale units swells and fades, and the glow fades in with a smoothstep. It lasts 1.8 s. Under reduced motion the candle appears fully lit.
- *Share card* (`web/public/og.png`, 1200×630): the empty moonlit garden from the live renderer, a left-to-right near-black scrim, the favicon at 72px, "EVERLIGHT GARDEN" in the serif at 68px (`#f3dca0`), and one 28px line of description.

**Responsive behaviour.** The header changes are in the table above (≤360, <1280, 1280–1439). Below 900px, tapping a candle on the canvas uses the same framing as Find: the candle is centred in the band between the header and the measured sheet.


## Revision 8 additions

- **Stairs and walks (garden scenery).** Flights of steps are built from the path tile (treads, with a `#c4bb98` nosing) and the wall tile (risers), with `#2f322b` stone cheeks and a moss cap. Each sits at a terrace end past the last holder and widens by one art pixel every two steps toward the viewer. Flagstone walks (path tile, `#24402b` moss edges, joints every 8 art px) join stair feet to the row path. The twin arches stand on a paved plinth with a mossy wall front and a central flight. Everything is drawn at the single 2-world-unit art pixel.
- **Anchored candle popup.** It sits above or below the flame, kept 8 px plus the pointer clear of the selection ring. When neither fits it goes beside the ring (right, then left) with the pointer on the facing edge (`.side-right`, `.side-left`, `--pointer-y`). If no side fits, it takes the band above or below with a scrolling body (`.capped`, `--pop-max`).
- **Treasury activity states.** Reading, Unavailable (`.bad`), Stale ("Showing activity from the last successful scan…", `.stale-note`: headline ivory with a 3 px `--gold-500` rule and `--space-2` inset), and the verified range line (`.fine`). Older-blocks and Try again appear only when the scan stopped early.
- **Share card.** `og.png` is 1200×630, taken from the empty pixel garden with the DejaVu Serif title in `#f3dc9a` and the subtitle in ivory over a left-hand dark gradient.


## Revision 6 additions

- **Split bar** (`web/src/App.tsx` `SPLIT`): four allocations (30% Burn, 60% Previous paid candles, 5% Operations, 5% Founder) plus a `.split-first` note, "90% burn for the first-ever candle". The note is allowed to wrap (`white-space: normal`), and its figure uses `--text-md`.
- **How it works** (`HowPanel`): section headings at `h3`, with `.bullets` lists, `.summary` allocation tiles and a `.faq` list.
- **FAQ** (`.faq`): native `<details>` cards on `--night-800` with a 1px `--color-border` edge, `--radius-sm` corners and `--space-2` gaps. Each `summary` is at least 44 px tall, 600 weight, with a 2px `--color-accent` focus ring. Answers use `--color-text-secondary`.
- **Light panel**: a second `.costs` disclosure, "Where your 1 IMD goes", sits under Cost details and links to How it works.
- **Style names** follow the contract: Purity, Hope, Love, Success, Health, Wealth, Happiness.
- No new tokens or type sizes. Responsive behaviour is unchanged: the split collapses into its "Split of 1 IMD" disclosure on narrow screens.


## Revision 9 additions (final source)

- **Ground** (`web/src/garden/scenery.ts`, `drawSectorBase`): one deep emerald (`rgb(20 40 29)`) with a slow tonal field (±7%) and a faint trace of `tile-grass-dark` (±12%); woodland cells 14% darker. Toward the skyline the ground blends up to 70% into haze `rgb(34 58 62)` over 220 world px (atmospheric perspective).
- **River**: half-width `32 + 7·sin(y/90) + 3·sin(y/37)` world px; depth shading 0.62→1.0 from channel to bank with sky-reflection streaks (×1.18); a 2 px wet edge `rgb(16 30 24)`; an irregular bank of 3–10 px of earth `rgb(38 46 30)` and scattered `tile-moss-stone` stones. Water ripples animate at any candle count and stop under reduced motion.
- **Light** (`web/src/garden/renderer.ts`): per-candle halo alpha 0.17 (radius 38·scale) and ground pool 0.15 (68×20·scale); overview light layer 0.2. Flicker stays bounded (0.88–1.0) and is fixed under reduced motion.
- **Components** (`web/src/everlight.css`, end of file): `.approved-box` (gold left rule, 6% gold tint), `.recovery`, `.reconcile` (monospace hash input, 44 px min height, gold focus ring), `.confirm-release` (coral border), `.btn.danger`, `.status-line .lit-count` (gold, 600) and `.loaded-count`.
- **Responsive**: the new boxes are single-column grids that fit the 390 px purchase sheet and the docked 1600 px panel; the hash row is a flex row whose input shrinks (`min-width: 0`). Tokens, type scale (13/15/17/20/28/44 px, Iowan Old Style + system-ui) and breakpoints are unchanged from the sections above.

## Revision 10 additions (final source)

- Purchase recovery is scoped per account: one saved intent per account (`intentHash("buy", account)`), saved exclusively under a Web Lock. The recovery panel shows and releases only the connected account's purchase.
- Fixture label: one per screen. It sits in the docked panel's `role=note` bar when that panel is open, and in the hero otherwise (mobile, or panel collapsed).
- Garden components (web/src/garden/scenery.ts, sprites in web/public/art/px, CC0):
  - Arches: stone `arch` with a `garland` overlay (pink #d98aa8/#f2c4d2, lavender #9a86c8/#c9bdf0, ivory blossoms, green-glass lantern on a chain).
  - Trees: willow clusters of 2-4 trunks mixing `willow-s` (30x38), `willow` (44x52) and `willow-l` (60x66), each depth-sorted on its own foot. Oaks and cypresses stand singly.
  - Terraces: earth bank behind the lawn (#132a1c/#183622) and a dithered contact shadow under the wall. Four arrangements are chosen per sector by `terraceArrangement(gx, gy)`: 0 hedge, 1 flower border, 2 lantern walk, 3 old ruin.
  - River: depth gradient water without a tiled texture, dark bank reflections, sparse glints, animated ripples (frozen under reduced motion), `reeds`, `bank-stones` and lily pads on the banks. The bridge has an arched deck (12 world-unit crown), a voussoir ring, a shadowed opening and a mirrored reflection.
  - Frog vignettes: `frog-fisher` on the bank below the bridge, `frog-lily` on a pool, `frog-sweeper` on the path, plus the earlier reader, gardener, wanderer and sitter.
- Pixel scale: 1 sprite pixel = 2 world units for all new art. Responsive behaviour is unchanged.
