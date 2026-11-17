# Everlight Garden design system

Taken from the final source: `web/src/styles.css` (base tokens, then the "Reference restyle (v2)" block, which overrides them), `web/src/garden/renderer.ts`, `web/src/garden/scenery.ts`, `web/art-src/paint.js` and the components in `web/src/`.

## Overview

A nocturnal fantasy garden fills the viewport, staged after the owner's approved reference:

- **Foreground frame:** carved stone columns and an arch, an emerald banner, white flowers and brass frog sculptures, with overhanging leaves along the top.
- **Middle distance:** terraced gardens with stone retaining walls, a moonlit stream that drops in a waterfall at every terrace, arched bridges, a domed gazebo and trees.
- **Distance:** misty terraced hills, mountains, a moon and a softly lit castle.

The interface is compact antique-gold chrome on near-black emerald:

- A slim header holds the brand, four tabs and Connect Wallet.
- A serif italic headline sits at the top left.
- Small side actions sit on the right.
- A bottom strip holds Find my candle, the minimap and the contract's economics.

There is no purple, no dashboard cards, and no reference pixels anywhere.

## Layers (render order)

| # | Layer | Source | Notes |
| --- | --- | --- | --- |
| 1 | Vista | `art/backdrop.webp` drawn in screen space | parallax of 0.02× pan; fades into `#06130c` at its foot |
| 2 | Sector scenery | `drawSectorArt()` in `scenery.ts`, cached per sector (0.75× hi-res, ≤24 cached; 0.125× overview) | the top band is transparent so the vista shows between sector rows |
| 3 | Candle holders | `drawPedestal()` at each slot from `positionOf()`, inside the sector cache | the cup sits `HOLDER_TOP` = 24 depth units above the slot point |
| 4 | Lighting | additive glow sprite per lit candle: a halo of radius 80k at 34% alpha, plus a ground pool of 92k×34k at 30% | flicker only without reduced motion |
| 5 | Purchased candles | `drawCandle()`: style sprite at 0.5k scale, flame at 1.5k | from contract data only; never pre-lit |
| 6 | Foreground frames | `.frames` HTML images (canopy, frame-left, frame-right) | `pointer-events: none`, `aria-hidden` |
| 7 | UI | header, intro, side actions, strip, panels, popup, sheets | HTML, keyboard reachable |

The decorative castle windows (backdrop) and the brass lanterns (row 3) are steady boxed lights. Only purchased candles have flames.

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

Scene palette (from `paint.js`/`scenery.ts`):

- **Sky:** `#03080d` → `#10283a`.
- **Moon:** `#fffef6` with a `#9fc4e8` halo.
- **Hills and mist:** `#132636`, `#0e1f22`, `#0b1d18`…`#06130c`, mist `rgb(110 150 170 / ≤0.1)`.
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

- **Header** (`.top`): the brand (favicon and "Everlight Garden · on IMD"). The four tabs Garden / My Candles / Rewards / Treasury sit between gold hairline dividers, and the active tab is emerald with a gold border. Connect Wallet (`ConnectSheet`) is on the right. Under 1100px the tabs move into a menu button; the menu lists all six routes.
- **Intro** (`.intro`): the h1 "Light a wish in the garden" with a centred gold rule, one plain line, a sales-status line with a live dot, and the fixture label when a fixture is active. Under 900px it also shows the primary CTA "Light a candle · 1 IMD".
- **Side actions** (`.side`, desktop ≥900px): Light a candle · 1 IMD, My rewards and How it works. Each is a 96px gold-bordered tile.
- **Bottom strip** (`.strip`):
  - Find my candle: a crosshair icon, a numeric input and a button. It searches any id, including ids not loaded yet.
  - A slot for the minimap (220×72 canvas, click to move).
  - The economics as a `<details>` list: 30% Burn, 30% Previous paid candles, 30% Ecosystem, 5% Operations, 5% Founder. It is open on desktop and collapsed to a "Split of 1 IMD" sheet under 900px.
- **Zoom** (`.zoom`): round + / − buttons at the left, above the strip.
- **Candle popup** (`.detail-wrap.anchored`): 320px, anchored above the selected candle's flame with a pointer notch and clamped to the viewport. It shows the id, owner (explorer link), style, date, position, the public wish (italic serif, rendered as text) and "View onchain". Under 900px it becomes a sheet above the strip. Escape or × closes it.
- **Panels** (`.panel`): Light a candle, My Candles, Rewards, Treasury and How it works. They open as a right drawer above the strip on desktop and as a 78% bottom sheet on phones. Escape returns to the garden, and focus moves to the panel on open.
- **Sheets, menus, toasts:** gold hairline, emerald-black gradient.
- **Controls:** each has rest, hover, pressed (scale 0.96–0.98), 2px ivory `:focus-visible` ring and disabled (60% opacity) states. Transitions are 150ms on named properties only.

## Responsive behaviour

| Width | Behaviour |
| --- | --- |
| ≥1500 | full strip, 20px percentages |
| 1100–1500 | tighter economics (17px, 8px padding) |
| <1100 | tabs collapse into the menu button; the "on IMD" suffix is hidden |
| <900 | side actions hidden and the intro CTA shown; minimap 132×44 above the strip at right; zoom row at left; economics become a collapsible sheet; right frame hidden; left frame 30vh; canopy 9vh; the popup becomes a sheet |
| <640 | the intro starts 40px below the header (keeps Connect from reading as an eyebrow); panels become bottom sheets; the strip hides under an open panel |
| <480 | the wordmark collapses to the mark |

At 390 wide the first screen shows the garden, the headline and the "Light a candle · 1 IMD" action (see `artifacts/screens/m390-live.webp`). Touch: drag pans, pinch zooms and tap opens a candle. Keyboard: arrows pan, + and − zoom, Find opens any id, and the register lists every candle. `prefers-reduced-motion` stops the flame flicker and the CSS transitions.

## Garden geometry (unchanged positions)

The square-spiral sectors (1200×900, 96 slots) and the slot positions in `layout.ts` are unchanged, so every existing candle keeps its place. Each sector is staged in perspective: six terraces with 8, 12, 14, 18, 20 and 24 slots run from far to near. Candle and holder scale grows with depth (`depthScale`), and the stream meanders (`sway`). Hit testing uses the candle body, 42 depth units above the slot. LOD: below 0.3× zoom, cached sector images with cached per-sector light layers; from 0.3×, sprites; from 0.7×, animated flames.
