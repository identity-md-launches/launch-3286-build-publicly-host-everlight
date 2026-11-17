# Everlight Garden: validation record

## Revision 3: reviewer findings on revision 2 (2026-11-17)

These are worker-side checks in headless Chromium (Playwright's Chromium headless shell, software rendering), run against the committed `dist/` served at a `/preview/` subpath. They are recorded here, not independently certified. **Live** means reads from mainnet RPCs. **Simulated** means `?fixture=N`, labelled on screen "Test fixture … not onchain". No transaction was sent, and no address, ABI or economic rule changed.

### Findings

| Finding | Reproduced on the revision 2 export | Fix | Recheck on the new export |
| --- | --- | --- | --- |
| Grid of identical sector tiles, flat rows, straight canal (`layout.ts:65`) | yes: the code put every 96 slots on the same six straight ledges (`ROW_COUNTS`) either side of one canal, on a square spiral of rectangles | `web/src/garden/layout.ts` rewritten: world-space `streamX`/`pathY` curves with seeded crossing points shared by both sectors on each edge; terraces are seeded elliptical arcs fitted around stream, path, pools and gazebo (`sectorPlan`); sectors grow in half-rings south of the home row. `scenery.ts` draws in world coordinates on a canvas with a 180-unit margin; `renderer.ts` fills the ground as one world-aligned pattern, and open garden edges fade into the night | `d1600-f3000-overview.webp`, `d1600-f10000-overview.webp`: one landscape with winding streams and paths, no tile seams or dark bands. `d1600-f100-pan.webp` (drag 800,500 → 200,300): terraces continue into the next sector. Unit tests: streams/paths continuous across edges, two sectors share fewer than 3 slot positions, more than 40 distinct slot heights per sector |
| Zoom and minimap cover the candle sheet at 390 (`styles.css:402`) | yes, by code: `.zoom` and `.detail-wrap` shared `bottom: calc(var(--strip-h) + var(--space-3))` under 900px | `Garden.tsx` adds `has-selection` to `.map-tools` while a candle is selected; under 900px `.map-tools.has-selection` (and its `.zoom`) is `display: none` | 390×844, touch, `?fixture=100`, Find 40: last sheet line at [29,720,361,739]; `elementFromPoint` there returns the sheet's own `.fine` line; zoom not displayed (`m390-candle.webp`) |
| Screenshots and asset manifest cited but missing | yes: `artifacts/` held only `validation.md` | committed `artifacts/screens/` (28 WebP files) and `artifacts/asset-manifest.md` (every file in `web/public/art`, its layer, generator function and licence; same text as `web/public/art/LICENSE.md`) | listed below |
| Frontal symmetric diagram, castle behind the side actions (`paint.js:351`) | yes: straight horizon, mirror-symmetric ledges, castle block at x≈1130–1330 | castle on its hill at (0.79 W, 0.22 H) of the backdrop, scale 0.42, landing near (0.78 W, 0.12 H) of a 1600 screen, clear of the side column, with a switchback road and square window lights down the slope; moon moved left; haze band. The home row now ends in an irregular land edge with three receding hill bands, tree lines, far pavilions and mist. Candle #1 is a 2.1× founding pedestal on a plinth at the head of a broad stone walk from the near left; the opening view puts it at about (0.30 W, 0.70 H). The stream bends and widens into pools with lily pads, has one seeded waterfall per sector, and the bridge is rotated to the path slope | `side-by-side-1600.webp` and `side-by-side-1600-f100.webp`. Still far from the illustrated reference in density and detail; see limitations |
| Header says "Connect" (advisory) | yes | "Connect wallet" from 600px; "Connect" below, with `aria-label="Connect wallet"` | `d1600-live.webp`; the shot script clicks `getByRole("button", { name: "Connect wallet" })` at 1600 and 390 (`d1600-connect`, `m390-connect`) |
| Brand hidden at 390 (advisory) | yes: `.brand span { display: none }` under 480px | only `.brand-on` hidden; the name is set at 17px on two lines | 390 body text starts "Skip to the garden tools \| EVERLIGHT GARDEN \| Connect"; no horizontal overflow at 320/390 (taste layout check) |
| Price split from its unit (advisory) | yes: "candle · 1" / "IMD" | `Light a candle\u00a0· 1\u00a0IMD` in the side action and intro CTA | side action reads "Light a / candle · / 1 IMD" (`d1600-live.webp`) |
| Hit test stops after 4,096 sectors (advisory) | yes: `sectorAt` filled a 4,096-entry map | closed-form `sectorAt` (inverse of the half-ring order) and a 3×3 neighbourhood hit test | vitest: `sectorAt(spiral(n)) === n` for n < 20,000 and n = 99,999, 393,216, 1,234,567; hit test at position 4096×96+7 with total 400,000 returns that position |

### Commands and results (final source)

| Command | Result |
| --- | --- |
| `cd web && npx tsc --noEmit` | exit 0 |
| `cd web && npx vitest run` | 2 files, **32/32 passed** (6 new layout tests) |
| `cd web && npx vite build` | built into `dist/` |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` (Playwright from outside the repo) | **16/16 passed** on the final export (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion, share) |
| `test/scratch/shoot.mjs` (not delivered) | 28 scenarios, **0 page errors, 0 action errors, 0 failed requests**, no horizontal overflow in any |

### Screenshots (`artifacts/screens/`, actual browser captures)

- Side-by-side reference vs actual: `side-by-side-1600.webp` (live, 0 candles) and `side-by-side-1600-f100.webp` (fixture 100, candle #40 open).
- Desktop 1600×1000: `d1600-live` (**live**: activated=false, 0 candles, every holder empty), `d1600-f0`, `d1600-f100`, `d1600-f3000`, `d1600-f10000` (**simulated fixtures**), `d1600-f3000-overview`, `d1600-f10000-overview`, `d1600-f100-pan`, `d1600-popup` (Find 40), `d1600-f10000-find9876`, and panels `d1600-light`, `d1600-treasury`, `d1600-rewards`, `d1600-mine`, `d1600-how`, `d1600-connect`.
- Mobile 390×844 (touch): `m390-live`, `m390-f0`, `m390-f100`, `m390-f3000`, `m390-f10000`, `m390-candle`, `m390-menu`, `m390-light`, `m390-treasury`, `m390-connect`.

### Rendering and interaction performance (headless, software rendering, 1600×1000)

`__lastFrame.ms` (draw time of the last frame) after each of 8 drags, then again after zooming out 6 steps.

| Fixture | Detail view median / p95 | Sectors / candles drawn | Overview median / p95 | Sectors / candles drawn | Find → popup |
| --- | --- | --- | --- | --- | --- |
| 0 (live layout) | 0.2 / 0.3 ms | 1 / 0 | 0.1 / 0.2 ms | 1 / 0 | n/a |
| 100 | 2.1 / 3.0 ms | 2 / 96 | 0.2 / 0.2 ms | 2 / 100 | 300 ms |
| 3,000 | 1.9 / 4.5 ms | 6 / 123 | 0.4 / 0.7 ms | 28 / 2,688 | 395 ms |
| 10,000 | 2.9 / 3.7 ms | 6 / 123 | 0.4 / 0.5 ms | 28 / 2,688 | 437 ms |

Building one sector's cached art costs about 50–80 ms (the first-frame values in the shot log), paid once per sector and neighbour set. Headless rAF caps FPS, so draw time is the meaningful measure.

### Better Interface review, revision 3

All six domains were rechecked on the changed surfaces. Accessibility: the wallet button has the accessible name "Connect wallet" at every width, and with map tools hidden the sheet's link is reachable by tap and Tab. Layout: no control covers the sheet at 390 or 320, and no overflow. Writing: the amount stays with its unit. Typography: the brand uses the existing 17px step, so the scale still has six sizes (probe: type-sizes pass). Colors: unchanged tokens. UI: the header now names the site on phones. Contrast inside the popup and panels was viewed in screenshots, not measured.

### Remaining limitations (revision 3)

- **Visual fidelity.** No image-generation tool was available, so the scene is procedural (Skia via `@napi-rs/canvas`). It now follows the reference's structure: vista with moon and castle on a hill, layered horizon, winding streams and paths, curved terraces, bridges, pools, a waterfall, a gazebo, a foreground founding pedestal, frogs and arches. It is still much less dense and detailed than the illustrated reference, and it does **not** meet the owner's 99% target. No similarity score was measured.
- At very wide overviews, streams appear in every sector column and paths in every row. They wind and are seeded, but the spacing is regular.
- The candle layout changed from revision 2. Positions are deterministic per candle id, and the contract has 0 candles, so no live candle moved.
- No wallet transaction ran in a browser; write flows remain covered by the labelled vitest mocks. No physical phone, Safari, Firefox or screen reader was used.
- Hosting is done by the publishing plane from the committed `dist/`. No publish command was run, and the public URL is not verified here.

---

## Revision 2: reference redesign (2026-11-17)

These are worker-side checks. They are recorded here, not independently certified.

- **Live** means a read from Ethereum/Base mainnet through public RPCs, reached through this machine's proxy.
- **Simulated** means a labelled fixture (`?fixture=N`, with a "Test fixture … not onchain" banner) or a labelled mock in vitest.

No transaction was sent and no contract, address, ABI or economic rule changed.

### Tooling and its limits

- **No image-generation tool was available.** All scenery is original procedural artwork from `web/art-src/paint.js`, rendered with Skia (`@napi-rs/canvas`, installed outside the repo) to WebP. See `artifacts/asset-manifest.md`.
- It replaces the primitive SVG scenery, which was deleted.
- It follows the reference's composition: framed foreground, terraced middle distance with stream, waterfalls, bridges and a gazebo, and a vista with moon, mountains and castle. It follows the palette and the UI placement too.
- **It does not reach the owner's 99% visual-similarity target.** The painting is much simpler than the illustrated reference. (The repeating sector grid noted here in revision 2 was replaced in revision 3, below.) **No similarity score was measured or is claimed.** Compare `artifacts/screens/side-by-side-*.webp`.
- Browser: Playwright's headless Chromium shell. It ran on Ubuntu runtime libraries and DejaVu/Liberation fonts extracted into a temp dir, because the machine has neither installed. Screenshots therefore use Liberation Serif in place of Iowan/Palatino. Rendering is software (SwiftShader), with no GPU.

### Commands and results

| Command | Result |
| --- | --- |
| `cd web && npx tsc --noEmit` | exit 0 (final source) |
| `cd web && npx vitest run` | 2 files, **26/26 passed** |
| `cd web && npx vite build` | built into `dist/` (JS ≈1.4 MB, of which 0.64 MB is the main chunk; art 0.5 MB; og.png 0.84 MB) |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | first run: 14/16 (eyebrows: "Connect" sat 18px above the h1 at 390; type-faces: 4 weights). After the fixes: **16/16 passed** on the final export |
| `test/scratch/shoot.mjs` and `perf.mjs` (headless Chromium, export served from disk at a `/preview/` subpath) | see below. Not delivered (scratch) |

### Browser checks on the export

| Scenario | Data | Result |
| --- | --- | --- |
| Garden, 1600×1000 | **live** (activated=false, 0 candles) | moonlit garden, every pedestal empty and unlit, "Sales closed until activation · 0 lit"; no horizontal overflow (`d1600-live.webp`) |
| Garden, 390×844 | **live** | headline, "Light a candle · 1 IMD", status and garden all on the first screen (`m390-live.webp`) |
| 100 / 3,000 / 10,000 candles | **simulated fixtures** | `d1600-f100`, `d1600-f3000`, `d1600-f10000`, `*-overview.webp`, `m390-f100.webp` |
| Find #40 → anchored popup with wish, owner, style, date | simulated | class `detail-wrap anchored`, popup notch over the flame (`d1600-popup.webp`) |
| Click directly on candle #40 (spatial hit test) | simulated | popup "Candle #40" |
| Find #9876 at 10,000 | simulated | camera jumped, popup "Candle #9876" (`d1600-f10000-find9876.webp`) |
| Escape | simulated | closes the popup; closes a panel back to `#/garden` |
| Mobile menu (390) | simulated | lists Garden, My Candles, Rewards, Treasury, Light a candle, How it works (`m390-menu.webp`) |
| Mobile economics sheet and candle sheet | simulated | `m390-split.webp`, `m390-candle.webp` |
| Light a candle and Treasury panels | live reads | `d1600-light.webp`, `d1600-treasury.webp`, `m390-light.webp` |
| Page errors | — | one uncaught `undefined` promise rejection and "Failed to execute inlined telemetry script", both from the bundled Coinbase wallet SDK chunk (`dist-*.js`) when its telemetry is blocked. No app errors and no failed site requests |

### Rendering and interaction performance (headless, software rendering, 1600×1000)

Values are `__lastFrame.ms` (draw time per frame) after drags. Medians are over 8 drags.

| Fixture | Detail view (LOD 2) median / p95 | Overview (LOD 0) median | Visible sectors / candles drawn |
| --- | --- | --- | --- |
| 0 (live) | 0.6 / 0.7 ms | 0.4 ms | 1 / 0 |
| 100 | 11.4 / 33.6 ms | 0.6 ms | 2 / 100 |
| 3,000 | 28.2 / 29.9 ms | 1.5 ms | 31 / 2,976 |
| 10,000 | 25.6 / 224 ms | 2.6 ms | 63 / 6,048 |

The first paint of a sector costs about 350–500 ms (one-off sector cache build), and the p95 of 224 ms at 10,000 is panning into uncached sectors. The cache is capped at 24 hi-res sectors. Find + camera jump + popup took about 3.3 s wall-clock, mostly the fixture lookup and the 800 ms settle waits in the script. Headless rAF limits FPS, so draw time is the meaningful measure.

### Better Interface review (six domains)

| Domain | Coverage | Findings → fixes |
| --- | --- | --- |
| Accessibility | checked | frames are `aria-hidden` with `pointer-events: none`; the popup closes on Escape (new global handler in `web/src/App.tsx`, which defers to the connect sheet's own Escape and focus trap); 44px targets (probe: targets pass); focus ring kept; reduced motion kept |
| Layout | checked | **F1** `web/src/garden/Garden.tsx`: the minimap was hidden under the strip (fixed `.garden` stacking context) → moved outside the canvas wrapper. **F2** `web/src/styles.css`: at 1440 the economics wrapped to two rows → tighter items under 1500px. **F3**: at 390 the frames covered too much garden → left frame 30vh, right frame hidden |
| Writing | checked | headline of six words or fewer plus one plain line; verb-first actions ("Light a candle · 1 IMD", "Find my candle"); economics use the contract's split, not the reference footer's obsolete numbers |
| Typography | checked | **F4** `web/src/styles.css` `.cta` 650 → 600 and h1 500 → 400 (probe: type-faces); six sizes; **F5** `web/src/App.tsx`: "Findmy candle" because flex collapsed the space → non-breaking space |
| Colors | checked | gold/emerald/near-black tokens, no purple; contrast passed by the probe on the first screen. Contrast inside panels was viewed in screenshots, not measured |
| UI | checked | **F6** `web/src/styles.css` (mobile `.intro`): "Connect" read as an eyebrow above the h1 at 390 → intro starts 40px below the header (probe: eyebrows pass); consistent gold hairline across header, strip, side actions, popup, panels and sheets |

### Remaining limitations

- The visual result is procedural and simpler than the reference (see above). Revision 3 replaced the repeated perspective sector with a continuous landscape.
- Foreground frames sit over the garden edges; candles behind them stay reachable through Find, the register and panning.
- No wallet transaction was exercised in a browser. Purchase, approval and claim logic is covered only by the vitest mocks from the previous job, unchanged. The contract is not activated, so live purchases are disabled.
- The mobile routing check of `#/mine` crashed the headless browser once in this environment, so that screenshot is missing; `m390-light.webp` shows the mobile bottom-sheet panel.
- `og:image` is relative (`./og.png`).
- Hosting: the committed `dist/` is the delivery, and the plane publishes it. No publish command was run.

---

## Revision 1 record (previous job, kept for history)


Worker-side checks on 2026-11-17. They are recorded, not independently certified. **Live** means a read from Ethereum/Base mainnet through public RPCs. **Simulated** means a labelled mock or fixture. No real-fund transaction was sent.

## 1. Scope and assumptions

- Pages reviewed: Garden (first screen), Light a candle, My candles, Rewards, Treasury, How it works, candle details, connect sheet, transaction-recovery toasts. All are in one hash-routed page. The export is `dist/`, built from `web/`.
- Live state at review time (via `cast` and in the browser): `activated=false`, `purchasesPaused=true`, `totalCandles=0`, `baseReady=true`, owner `0x48E4…6ec9`, Base receiver `totalBurned=0`, `pendingBurn=0`. The live garden therefore shows only empty holders and disables purchasing. That is correct, not a fixture.
- Inferred choices: style names (Moon taper, Ember pillar, Lantern bloom, Lily float, Gilded spiral, Frog lamp, Star votive) are cosmetic labels for onchain styles 0–6. There are 96 holders per sector. System fonts, no web fonts. WalletConnect is not wired because no project ID was supplied, as the wallet-connectors guide prescribes.
- Hosting: per the assignment's reference, the committed `dist/` is the delivery and the plane pins and names it. I ran no publish command, so the public HTTPS URL and GitHub publication are outside this run.

## 2. Commands and results

| Command (in `web/`) | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0, no errors (final source) |
| `npx vitest run` | 2 files, **26/26 tests passed** (revision added 2 Find/`getCandle` tests) |
| `npx vite build` | built; `dist/` 1.8 MB (JS 1.4 MB, gzip about 410 KB; og.png 332 KB; art 60 KB) |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` (repo root, Playwright 1.x from outside the repo) | **16/16 passed** on the final build (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion, share) |
| `node test/scratch/e2e.mjs` (Playwright headless Chromium on a local static server at a `/preview/` subpath) | all scenarios below ran with 0 page errors and 0 failed requests |

Unit tests (`web/tests/`): the wish limits mirror `Utf8Wish` (280/281 code points, 280 emoji = 1120 bytes, lone surrogate rejected), and the gas bound matches the contract docs. The candle store loads 0/100/3000/10000-candle fixtures in pages of ≤100, makes exactly `ceil(n/100)` page calls and fetches nothing new on resync. Page size >100 is rejected. `candleIdsOf` pagination terminates. Layout positions are unique and deterministic for 10,000 candles, and the hit test is exact. **Purchase flow on labelled mocks**: exact approval → receipt → simulate → buy → receipt order. Approval is skipped when covered. It stops on closed sales, wrong network, insufficient IMD, wallet cancellation and a failed simulation (no buy request), and reports a reverted receipt. The pending hash is kept on RPC failure for reload recovery. The wish renders as escaped text through React SSR.

## 3. Browser evidence (headless Chromium, emulated viewports)

| Scenario | Measured |
| --- | --- |
| Live, 1440×900 / 390×844 / 320×640 | status "Sales closed until activation · 0 lit" read live in about 2.1–2.3 s; h1 and "Light a candle" inside the first viewport at all three widths; no horizontal overflow |
| Fixture 0 / 100 / 3000 / 10000, 1440 | navigation to all candles loaded: 5.4 / 5.9 / 6.8 / 7.0 s (includes wallet SDK boot); store streaming after first paint 0.2–0.4 s |
| Draw cost per frame, close zoom (LOD 2, about 120 candles visible, animated) | 2.7–4.0 ms |
| Draw cost, full overview (LOD 0) | fixture 3000: 32 sectors, median 0.5 ms; fixture 10000: 105 sectors, all 10,000 candles, **median 16.5 ms, max 19.2 ms** (before the fix: 897 ms, see F1) |
| Mobile 390 with 10000 fixture | no overflow on garden, light, mine, rewards, treasury or how |
| Light form | 281-char wish shows "Shorten this wish by 1 characters (limit 280)"; 280 emoji show 1120/1120 bytes and are accepted; button disabled, with the reasons listed (sales closed, not connected, wish limit, privacy acknowledgement); custom 50 + "One per candle" renders 50 rows |
| Find / escaping | `#7` and `#2` open details whose wishes `<img src=x onerror=…>` and `<script>…` render as text, with 0 child elements in the quote; `#500` gives "Candle #500 does not exist yet. The newest is #100." |
| Reload | saved camera identical after reload; clicking the candle at the centre opens "Candle #2" |
| Connect sheet | opens as a dialog listing "Browser wallet" and "Coinbase Wallet" (no extension in headless); Escape closes it and focus returns to Connect |
| Missing assets (`?noassets=1`) | 11 assets reported missing, garden still draws with fallbacks, 0 page errors |
| Reduced motion | 0 frames drawn in 3 s idle (52 frames in 3 s without reduced motion) |
| Pending-tx recovery | a real, already-mined mainnet tx hash (not ours) was seeded as a pending "buy". After reload the toast read "Your earlier purchase confirmed…" and the pending list emptied. This simulates recovery against a live receipt. |

Screenshots were inspected in `test/scratch/shots/` and `test/scratch/taste/shots/`. That folder is removed before submission, so it is not delivered. Those inspected: live-390 first screen, detail-1440, fixture-10000 overview, m390-light, m390-treasury and taste 390.

## 4. Better Interface review (six domains)

| Domain | Status | Coverage |
| --- | --- | --- |
| Accessibility | Checked | native buttons, links and inputs; labelled controls; visible 2px focus ring; skip link; keyboard pan/zoom on the canvas plus a paged register so every candle is reachable without pointer; dialog Escape and focus return; live regions for steps, errors and toasts; reduced motion; 44px targets (probe: targets pass) |
| Layout | Checked | first screen at 390 and 320; panel drawer vs bottom sheet; no overflow on any panel at 390 |
| Writing | Checked | verb-first buttons ("Light 5 candles", "Approve and light…", "Claim 0.3 IMD"); errors say how to fix; empty states point forward; burn stages say "Not burned yet" |
| Typography | Checked | six sizes, two families, three weights (probe); tabular numbers; balance/pretty wrapping |
| Colors | Checked | semantic tokens over primitives; contrast measured by the probe at 320/390/1440 (pass). Contrast inside panels and the detail card was not measured, only viewed |
| UI | Checked | four control states; no border+shadow combos (probe); CSS transitions only, no `transition: all` |

### Findings and fixes

| # | Sev | Location | Evidence | Fix | Recheck |
| --- | --- | --- | --- | --- | --- |
| F1 | HIGH | `web/src/garden/renderer.ts:108` (litLayer), `:46` | the 10,000-candle overview took 897 ms per frame: an 80-entry sector cache thrashed over 105 sectors, plus 10,000 additive glows each frame | low-res sector cache plus per-sector cached light layer at LOD 0; hi-res cache capped at 48 | 16.5 ms median |
| F2 | HIGH | `web/src/garden/renderer.ts:215` | screenshot at 100 candles: the whole terrace washed gold (glow r=150, alpha 0.34), against the brief's "without whitening" | glow r=80, alpha 0.22, smaller reflection | detail-1440 screenshot: light stays local |
| F3 | MEDIUM | `web/src/styles.css:150` | the fixture label rendered faint because `.intro p` overrode its colour | raised specificity to `.intro .fixture` | label legible in the screenshot |
| F4 | MEDIUM | `web/src/styles.css:161-163`, `:271`; `web/src/App.tsx:150` | m390-treasury: the dock showed through the 94%-alpha panel | opaque panel surface; dock hidden under a mobile panel | rechecked in the screenshot |
| F5 | MEDIUM | `web/src/styles.css` (mobile `.map-tools` / `.dock`) | at 390 the minimap overlapped the three-row dock | two-row dock; tools raised to 136px | taste 390 screenshot |
| F6 | LOW | `web/src/App.tsx:117`, `web/src/styles.css:256` | probe `eyebrows`: the short "Menu" and then "Connect" controls sat within 40px above the h1 at 390 | menu became a labelled icon button; mobile intro top padding increased | probe 16/16 |
| F7 | LOW | `web/src/styles.css:204` | rows and summary tiles had the same colour as the panel, so their boundaries were invisible | rows, tiles and stages moved to `--night-800` | viewed |

## 5. Limitations (unresolved)

- **No wallet transaction was exercised in a browser.** Purchase and claim logic was tested on labelled mocks (vitest), not on a mainnet fork. The live garden is not activated, so `buyCandles` simulation on mainnet would revert `PurchasesDisabled`. The claim UI was checked only with no wallet connected.
- Connect sheet: real EIP-6963 extensions, the Coinbase SDK popup and the mobile "Open in" links were not run. A labelled EIP-6963 mock wallet was used for connection, wrong-network, `accountsChanged` and rejected `eth_sendTransaction` (revision, section 6). The Rabby link uses the `go.rabby.io/mobile/` form and has no vendor documentation.
- Browser: headless Chromium with software rendering and emulated mobile viewports. No physical phone, Safari or Firefox, no screen-reader session, no native 200% zoom. FPS values are limited by headless rAF; draw-time ms is the meaningful measure.
- The localStorage candle cache is best effort. At very large counts with long wishes it can exceed quota and fall back to memory, so a fresh load re-reads pages (100 per call).
- Treasury activity covers at most the latest 40,000 blocks (8 × 5,000), so older events need an explorer link. Balances are unaffected.
- `og:image` is a relative URL (`./og.png`) because the final host is not known here. Some unfurlers need absolute URLs.
- The JS bundle is 1.4 MB uncompressed, mostly the wallet SDKs.

## 6. Revision: reviewer findings (2026-11-17)

Each finding was first reproduced in headless Chromium against the previously committed `dist/`, extracted with `git archive HEAD dist`. Then it was fixed and rechecked against the new export. The script was `test/scratch/verify.mjs`, which is not delivered. It used a labelled mock JSON-RPC (decoding multicall3 `aggregate3` against the pinned ABI) and a labelled EIP-6963 mock wallet that rejects every `eth_sendTransaction` with code 4001. Nothing was broadcast.

| Finding | Old build | Fix | New build |
| --- | --- | --- | --- |
| Hidden individual wish at qty 1 (`LightPanel.tsx`) | reproduced: decoded wallet request `buyCandles([2],["HIDDEN WISH"])`; a 281-char visible wish was not flagged | one effective mode `each = mode==="each" && qty>1` drives both the editor and the submitted items | `buyCandles([6],["VISIBLE WISH"])`; 281 chars flagged "Fix the wish marked above" |
| Header clips Connect / Switch (`styles.css`) | reproduced: header scrollWidth 324 at 320 (Connect); 397 at 320 and 390 (Switch to Ethereum) | ≤480px hides the wordmark text and keeps the labelled favicon link; `min-width:0`; the switch-error note floats below | scrollWidth = clientWidth at 320 and 390; every control's right edge ≤ viewport, with and without a wallet on chain 8453 |
| Approval with no gas estimate | reproduced: "Estimated gas …", approve enabled | a gas query error or pending state blocks submission and is listed in problems; "Retry gas estimate" button | disabled with "Unavailable" and a retry; after retry the estimate shows and approve sends exactly `0x095ea7b3` (rejected by the mock) |
| Wallet modal focus escapes | code read (no trap, no inert) | sheet portalled to body; `#root` inert while open; Tab/Shift+Tab cycle | 9 Tab/Shift+Tab presses stay inside; Escape clears inert and focuses Connect |
| Treasury 0 on failed reads | code read: `?? 0n` | totals only when all parts are defined; every stage shows "Unavailable"; an alert offers Try again | withdrawal counters failing → "Withdrawn by owner: Unavailable" plus the alert |
| Find vs loaded count | code read: compared against `candles.length` | `CandleStore.lookup` compares with the onchain total and reads `getCandle(id)` when the page is missing; loading/error messages | total 3000, pages after #100 failing: Find 3000 opens "Candle #3000"; with `getCandle` also failing: "Candle #3000 could not be loaded. Try again."; 3001 → "does not exist yet" |
| My candles page on account change | code read: page index kept | reset to page 0 on address change; clamp when the page count shrinks | fixture 101: page 2 (1 row) → `accountsChanged` 0x2222… → 25 rows on page 1 |
| Flat equal rows (taste) | `TERRACES` 162 units apart, every candle 28×56 | receding scene, see DESIGN.md "Garden scene" | screenshots at 1440 and 390 (0, 100 and 3000 fixtures) show a near/far plane. Last-frame draw cost measured 1.5–9 ms at 1440 and 7–10 ms at 390 (headless, software rendering) |

The browser checks passed 17/17 on the new export. The taste probe passed **16/16** on the final build, and the 390 screenshot shows the h1, the status and the "Light a candle" dock on the first screen. `tsc --noEmit` exited 0 and `vite build` succeeded.

Limits of this revision: the scene was judged from screenshots only, in headless Chromium. The candle layout changed from the previous round. Positions are still deterministic per candle ID, and no live candles exist yet (`totalCandles=0`), so no lit candle moves.

## Completion

Complete for the stated scope, which is a static export with live reads and simulated writes. The limits are listed above, mainly the untested real-wallet transactions and the absence of physical-device or screen-reader checks.
