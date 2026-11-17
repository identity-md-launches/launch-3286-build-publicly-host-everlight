# Everlight Garden: validation record

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
