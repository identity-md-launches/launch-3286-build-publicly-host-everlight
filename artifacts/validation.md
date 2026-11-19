# Validation: revision 8 of job 12f1426d (2026-11-19)

All results are worker-side, on this machine, against the final `dist/` built by `vite build` after the last source change. The verifier checks paths and bytes only. The npm registry was reachable this run, so the real toolchain was used.

## Toolchain
| Check | Command | Result |
|---|---|---|
| Install | `cd web && npm ci` | ok |
| Typecheck | `cd web && npx tsc --noEmit` | exit 0 |
| Unit tests | `cd web && npx vitest run` | 12 files, 119/119 passed |
| Build | `cd web && npm run build` | ok, relative `./` asset URLs |
| Design probe | `taste.mjs --out test/scratch/taste` | 16/16 passed at 320/390/1440 (`evidence/rev8/rev8-taste-probe.json`) |

Where the evidence lives: `artifacts/` is listed in this checkout's `.git/info/exclude`, so new files written there never reach the commit. That is why revision 7's `rev7-*` evidence was missing. Revision 8's raw results, probe report and screenshots are committed under `evidence/rev8/`, with identical copies in `artifacts/`.

## Browser checks: `evidence/rev8/rev8-browser-checks.json` (26 passed, 0 failed)
Environment: **mocked**. Local static server, Playwright 1.x with Chromium headless shell (SwiftShader), and every non-local request aborted (`blockedHosts` in each record). Pages used `?fixture=N` with transactions disabled, or the live build with all RPCs blocked. No fork, no live RPC read, no transaction. "Before" is the export committed at the start of this job (`git archive HEAD dist`); "after" is this build.

| Check | 1600×1000 | 390×844 (touch, DPR 2) |
|---|---|---|
| 6 routes at `?fixture=100` (garden, mine, rewards, treasury, light, how): fixture label, no horizontal overflow, no page errors, no local 404s, no "Ecosystem (30%)" | 6/6 pass | 6/6 pass |
| Fixtures 0 / 3000 / 10000: render, no overflow, no errors | pass | pass |
| Water at 0 candles, pixels changed in 700 ms, after | 1484 | 1754 |
| Same, before (the previous export already animated water) | 1487 | 1745 |
| Reduced motion, 0 candles | 0 (still) | 0 (still) |
| Find 37 opens Candle #37 with its owner address | pass | pass |
| 50 candles × 280 "a": split plan | 1–30 (≤16,320,000 gas), 31–50 (≤10,980,000 gas) | same |
| The same draft after a reload | qty 50, wish 280 characters | same |
| Live build, RPCs blocked, `#/how` register | "Unavailable … does not mean the garden is empty. Try again"; canvas name "number of lit candles could not be confirmed yet" | same |

Screenshots (`evidence/rev8/screens/`, JPEG; desktop downscaled to 1200 wide, mobile to 390 wide):
- After: `rev8-after-{d1600,m390}-{garden,mine,rewards,treasury,light,how}.jpg`, `-fixture{0,3000,10000}.jpg`, `-find37.jpg`, `-split-plan.jpg`, `-register-rpc-blocked.jpg`
- Before: `rev8-before-{d1600,m390}-{garden,light,how,fixture0}.jpg`

## Findings of this round
| Finding | Verdict | Fix | Evidence |
|---|---|---|---|
| 3d9a6e47 evidence missing | fixed | raw results, probe report and before/after screenshots committed; revision 7's dangling references corrected below | this file, `evidence/rev8/*` |
| 7b461b68 raised terraces without a route | fixed | `stairsOf` (`web/src/garden/scenery.ts`): terraces with no connected flight are drawn as ground-level beds; unreachable flights dropped | reproduced 1,665 / 1,410 / 1,275 (sector 0: 18 / 16 / 13). Now 1,275 raised terraces, all with a connected flight, plus 390 beds (sector 0: 13 raised, all connected, plus 5 beds). `tests/revision8.test.ts` |
| 2fe5f5a4 pending lock lost on reload under quota | fixed | recovery intent saved before signing (`purchase.ts` `persist`/`replace`, `INTENT_HASH`), resolved by nonce on reload (`chain.ts` `settleReceipt`) | unit tests: a 64-char quota means 0 sends. Intent kept: after a module re-import, the guard is locked and 1 send total |
| 6fcf22b8 known count hidden without first page | fixed | `Register` and `Garden` aria-label (`verified` prop) | `tests/revision8.test.ts` (rendered markup); the browser check covers the RPC-blocked state only |
| 21e2a39d claim resendable during pending | fixed | `RewardsPanel` subscribes to saved claims; `checkClaim` shared with reload recovery | code path and typecheck. **No browser wallet mock was run for this** |
| 39004380 over-cap estimate blocks the batch | fixed | `fittingPrefix` + `refit` re-plan; `isGasCapError`; approval regex narrowed | unit tests: prefix search gives 20 of 30, the plan becomes 20/30, and the RPC message is not shown as an approval error. **No browser wallet mock was run** |

## Better Interface review (changed surfaces)
- **Accessibility**: new states use `role="status"` (loading, pending claim) and `role="alert"` (failed first page). Check again and Forget are real buttons. The canvas accessible name no longer says 0 for an unknown count (`web/src/garden/Garden.tsx:271`).
- **Writing**: plain sentences that say what happened, that nothing was sent and what to do next (`web/src/lib/errors.ts`, `RESPLIT`, gas cap).
- **Layout, typography, colours, UI**: existing components only (`.pending-box`, `.split-plan`, `.fine`, `.bad`). There are no new tokens. The taste probe found no overflow, overlap or contrast failures at 320/390/1440.
- Rendered contrast beyond the taste probe was not measured.

## Not done / limitations
- No browser check with an injected wallet or a mocked RPC was run for the claim lock, the gas re-plan or the register's "0 of 100" state. viem's multicall batching made an RPC mock too costly for this run. Those three are covered by unit tests and rendered markup only.
- A recovery intent whose nonce is still unused after a reload stays locked with Check again and "Forget it". The site cannot tell a signature request still open in the wallet from one that was never signed.
- If the wallet sends with a different nonce than the preflight pending nonce, an intent cannot find that transaction. The form stays locked until the visitor releases it.
- Hosting: HTTPS and a fresh load of https://everlight.imd.site/ were not checked from here. The plane publishes the committed `dist/`.
- No live purchase, claim, approval or fork test ran.

---

# Revision 7: review fixes for job 12f1426d (2026-11-19)

All results are worker-side, on this machine, against the final `dist/` built by `vite build` after the last source change. The verifier checks paths and bytes only.

## Toolchain
`npm ci` and `tsc --noEmit` exit 0, `npx vitest run` 11 files 112/112 passed, `npm run build` ok. The npm registry, GitHub raw files and the task RPC were all reachable this time.

## Browser checks (Playwright 1.64 alpha, Chromium headless shell r1248, SwiftShader, local static server)
Raw: revision 7's `rev7-browser-checks.json` was never committed. Revision 8 above replaces it with `evidence/rev8/rev8-browser-checks.json`. "Before" is the export committed at the start of this job (`git archive HEAD dist`); "after" is this build. Every page used `?fixture=N` with transactions disabled, or the live build with **every non-local request blocked**. Everything here is **mocked**: no fork, no live RPC read, no transaction.

| Check | 1600×1000 | 390×844 (touch) |
|---|---|---|
| 6 routes at `?fixture=100`: renders, fixture label shown, no horizontal overflow, no page errors, no local 404s, no "Ecosystem (30%)" | pass | pass |
| Fixtures 0 / 3000 / 10000 render without overflow | pass | pass |
| Find 37 opens Candle #37 with the owner address | pass | pass |
| Water at 0 candles (canvas pixels that changed in 700 ms), **before** | 0 | 0 |
| Water at 0 candles, **after** | 1469 | 625 |
| Default view at 100 candles, after | 171412 | 56527 |
| Reduced motion, 0 candles, after | 0 (still) | 0 (still) |
| 50 candles with 280 × "a": split plan | 2 purchases (1–30, 31–50); bounds 16,320,000 and 10,980,000 gas | same |
| Same draft after reload | qty 50, wish 280 chars, plan kept | same |
| Live build with RPCs blocked, `#/how` register | "Unavailable … This does not mean the garden is empty. Try again" | same |
| Header Connect button colours | bg rgb(42,82,51), ivory text, 15px (7.17:1 computed from these colours) | same |

Console errors on these pages are all `net::ERR_FAILED`. They come from the harness deliberately blocking the public RPCs.

Screenshots: revision 7's `rev7-*` files were never committed. Revision 8's `evidence/rev8/screens/rev8-*.jpg` replace them. Originally listed:
- After: `rev7-after-<vp>-<route>.jpg` for garden, mine, rewards, treasury, light and how; `rev7-after-<vp>-fixture{0,3000,10000}.jpg`; `rev7-after-<vp>-find37.jpg`; `rev7-after-<vp>-split-plan.jpg`; `rev7-after-<vp>-register-rpc-blocked.jpg`.
- Before: `rev7-before-<vp>-{garden,light,how,fixture0}.jpg`.

## Design probe and Better Interface review
`taste.mjs` passed 16/16 at 320/390/1440. The report `rev7-taste-probe.json` was not committed; see `evidence/rev8/rev8-taste-probe.json`. The 390 view shows the headline, the garden and "Light a candle · 1 IMD" on the first screen.

Better Interface pass over what changed:
- **Accessibility**: the split plan is `role="status"` with an ordered list. Register states use `role="status"`/`role="alert"`, and Try again is a real button. CTA contrast was fixed (`web/src/pixel.css:47-54`).
- **Writing**: plain sentences. Unknown is never shown as zero (`Panels.tsx` Register).
- **Layout**: the split rows wrap (`everlight.css`, `.split-plan li`). No overflow was found at either width.
- **Typography and colours**: existing tokens only.
- **UI**: one button that always names the next purchase ("purchase 1 of 2").
- Contrast was measured by taste.mjs's own check. The ratios quoted above are computed from colour values.

## Not done / limitations
- **Terraces**: 255 of 1,665 raised terraces still have no flight, because both ends of their wall are crowded by holders. A further 135 flights have no route that avoids holders and water. Those terraces stay raised without steps.
- **Hosting**: HTTPS and a fresh load of https://everlight.imd.site/ were not checked from this machine. Publishing is done by the plane from the committed `dist/`.
- **Live**: no live reads were made by the browser harness. No purchase, claim, approval or fork test ran. Split purchases and storage failure are covered by unit tests on labelled mocks only (`web/tests/revision7.test.ts`).
- The previous round's report (below) cites `artifacts/rev6-browser-checks.json` and `artifacts/screens/rev6-*`. Those files were never committed. This round's evidence replaces them.

---

# Revision 6: live revised garden, new economics and help (job 12f1426d)

## What changed
- **Contracts** (`web/src/config.ts`): garden `0x33a514c5e2028f1affd70b82f170e8193df030a5`, Base receiver `0x4FdE47d5b574F9F18bC86D9878A460e6b1373D1E`, IMD and owner unchanged. Event scans start at block **26448736**: that is the block of creation tx `0x9305085fac09f628e90afdcd1d9a6dc5cfdbb21b2a8c36780eedbe10a6004a8e` (a CREATE2 factory call), read from eth.blockscout.com. The source link now points at `launch-3312-everlight-garden-deploy-revised@5752e230`.
- **ABI**: I compared `docs/abi/WishGarden.json` at 5752e230 with the old ABI entry by entry. Every function, error and signature matches; the only addition is `event BurnAllocated(uint256 indexed candleId, uint256 amount)`, which is now in `web/src/abi/WishGarden.ts` and in the bundle. `docs/base/EverlightBurnReceiver.json` has the same entries as the old receiver ABI. Caveat: I could only reach these files through a page-reading tool that summarises, not as raw bytes, so this is an entry-by-entry comparison, not a byte diff.
- **Readiness** is still read live (`activated`, `purchasesPaused`, `baseReady`); nothing is hardcoded.
- **Cache keys**: `everlight:v2:candles:<garden>`, `everlight:v2:tx:<garden>`, and `everlight:v2:pending:<garden>`. The pending key used to be unscoped, so a transaction sent to the old contract could have been re-attached to the new one; now it cannot.
- **Legacy**: the old garden `0x39e5…3b31` appears only as a read-only Etherscan link (Treasury → Contracts and How it works). It is never read, cached or written, so its candle IDs cannot mix with the new garden's. It had 0 candles when read on 2026-11-18 (rev 5). I couldn't re-read it this run.
- **Economics**: split bar, How it works, Rewards, Treasury and the Light panel now say 30% burn, 60% earlier paid candles, 5% operations, 5% founder, ecosystem 0%. The first-ever candle gets 90% burn. The Ecosystem bucket row and the "ecosystem bucket" copy are gone.
- **Styles** now use the contract names, in index order: Purity, Hope, Love, Success, Health, Wealth, Happiness.
- **Help**:
  - How it works was rewritten to cover: purpose, purchase steps with price and gas, the seven styles, batch splitting, public and permanent wishes (280 code points / 1,120 bytes), allocation, sequential per-candle rewards with the 101 → 0.006 / 0.018 example, batch order, manual claiming per contract, the five burn stages (only "Burned on Base" is called a burn), owner responsibilities, what a candle is (a contract record, not an NFT, not a share of treasury assets; 10,000 slots is a layout, not a cap), contract links, and an FAQ (no IMD endorsement, not an investment).
  - Beside the purchase action there is a new "Where your 1 IMD goes" disclosure.
  - Rewards has the worked example and explains manual claiming.

## How the export was produced (important limitation)
Every outbound connection from the shell was refused on this machine: npm registry, GitHub, the Etherscan relay and the local RPC (via the proxy: `Empty reply from server`). `web/node_modules` does not exist, and there is no vite, typescript, react or viem anywhere on disk. **So `npm run build`, `tsc --noEmit` and `vitest` could not run.**

Instead I made each change in `web/src` and mirrored it into the committed export:
- Plain string constants were replaced exactly, with each match count asserted.
- The changed JSX (How it works, the Rewards bullets, the Treasury note and legacy row, the split note, the Light panel disclosure) was compiled from the edited source with the Babel bundled in Playwright (TypeScript + React automatic runtime). It was renamed to the bundle's minified bindings and spliced in.
- The CSS added to `web/src/styles.css` was appended, minified, to the export stylesheet.
- The changed files got new content-hash names (`index-EpotlNQ3.js`, `index-JBgzkUub.css`) so caches load them fresh. References in `index.html` and the lazy chunks were updated.
- Every JS chunk passes `node --check`.

`npm ci && npm run build` from `web/` regenerates an equivalent `dist/` once the registry is reachable. That rebuild has not been run.

## Checks actually run (Playwright Chromium headless shell 1248, local static server, this machine)
Full data: `artifacts/rev6-browser-checks.json`. All checks below are **fixture/mocked**, with transactions disabled. **No fork or live transaction checks ran**, and no spending happened.

| Check | 1600×1000 | 390×844 |
|---|---|---|
| Six routes (garden, mine, rewards, treasury, light, how) at `?fixture=100`: render, no horizontal overflow, fixture label shown, no "Ecosystem (30%)" | pass | pass |
| Fixtures 0 / 3000 / 10000 render | pass | pass |
| Find candle 37 opens its detail | pass | pass |
| Water/canvas motion at 0 candles (main canvas, 900 ms) | changes | **no change measured** (see unresolved) |
| `prefers-reduced-motion: reduce` stops canvas motion | pass | n/a |
| How it works FAQ opens with keyboard (Enter) | pass | – |
| Address links point to the new garden, receiver, IMD and owner | pass | – |
| Local asset 404s | none | none |

Console errors on every page are `net::ERR_EMPTY_RESPONSE` from the public RPCs, which the sandbox blocks.

Live mode (no fixture) loaded, but no live value could be read from here: after 6 s the Treasury was still reading. **I couldn't verify live readiness or balances, HTTPS on everlight.imd.site, or a fresh load of the hosted site.**

Screenshots are in `artifacts/screens/rev6-*.jpg`:
- after: `rev6-d1600-*`, `rev6-m390-*`
- before (original export, same fixture): `rev6-before-*`

## Design probe and Better Interface review
- `taste.mjs` **did not run**. Its Playwright needs Chromium revision 1246 and only 1248 is installed; I couldn't install a matching one offline.
- Better Interface, applied to what this revision changed:
  - Accessibility: the FAQ uses native `<details>`/`<summary>` with 44 px targets and a visible focus ring (`web/src/styles.css`, end of file).
  - Writing: plain language, numbers given as amounts (0.60 / 0.006 / 0.018 IMD), queued funds never called burned (`web/src/panels/Panels.tsx`, HowPanel).
  - Typography and colours: only existing tokens.
  - Layout: the split note wraps instead of clipping (`.split li.split-first`).
  - Rendered contrast was not measured.

## Unresolved
1. **Art.** The art direction items in the brief were not done because no build tool was available: connected paths/stairs replacing floating platforms, four terrace arrangements, the scenery and depth rework, and the sprite and animation changes. The renderer, scenery and layout are unchanged from rev 5.
2. **Mobile water.** At 390×844 with the default camera, the stream is not in view and no canvas change was measured.
3. **Unit tests and typecheck** (`vitest`, `tsc`) were not run, and no fork tests ran.
4. The purchase, approval, receipt, replacement and split logic is unchanged from rev 5 apart from the addresses and keys. It was not re-tested against the new contract.


---

# Validation: 16-bit pixel revision (2026-11-19)

All results are worker-side on this machine. The verifier checks paths and bytes only.

Approved reference: https://the-imd-daily.duckdns.org/files/42ead1afe64349b79c4d154b7a452b5c8ab517de9be40331eb519d232c4ef83a.png
fetched (HTTP 200, 2,786,851 bytes, sha256 recorded in the job log) and inspected before any artwork was made.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npx tsc --noEmit` | exit 0 |
| Unit tests | `cd web && npx vitest run` | 8 files, 90/90 passed (receipt, calldata, nonce recovery, tx hash, popup, wish limits, escaping, quantity) |
| Production build | `cd web && npm run build` | built `dist/` with relative `./` URLs |
| Pixel assets | `cd web && node art-src/pixel/build.mjs` | 41 PNGs + manifest in `public/art/px`; contact sheet reviewed by the worker |
| Browser walkthrough | Playwright 1.49 / headless Chromium 131 with Ubuntu noble libraries unpacked in /tmp | **FAILED TO RUN: the garden tab crashed ("Target crashed") within about 1 s at 1440x900 for `?fixture=0`, `?fixture=100` and `?noassets&fixture=0`. Plain pages with canvas drawing rendered fine in the same browser. Chromium logged no reason and the cause was not found in the time available.** |
| Design probe (taste.mjs) | not run | Needs the same browser. Not performed |

## What is NOT verified in this revision
- No screenshots: no rendered garden, no before/after images, no 390-wide first-screen check, no measured
  frame times or contrast. The `artifacts/screens` images are from the previous (painted) revision.
- Interaction flows (pan, zoom, minimap, Find, selection popup, mobile sheet, RPC retry) were not exercised in
  a browser this revision. Their code was not changed, apart from rendering.
- The tab crash is an open defect. Before publishing, it has to be reproduced in a desktop browser and either
  ruled out or fixed. Possible causes are the per-pixel cell painting in `scenery.ts` and the cache sizes in
  `renderer.ts` (`TIER_KEEP`).
- Wallet actions (connect, approve, purchase, replacement/cancel, claim) are untested live, as before. No
  transactions were sent. Contracts, ABIs, addresses, economics, ID-to-position mapping (`layout.ts`
  unchanged) and the transaction protections are untouched.

## Better Interface review (static, no browser)
Coverage: accessibility (focus ring 3px gold on all focusables, `pixel.css`; decorative preview `aria-hidden`),
layout (unchanged responsive structure), writing (no copy changes), typography (still six sizes), colours
(ivory #efe6cc on #0b1712 and on the #3f7a3c button are computed contrast pairs from tokens, not measured
rendered), UI (square pixel frames applied consistently through `--px-frame`). Finding fixed: the vector
purchase preview mixed smooth art with pixel sprites (`web/src/panels/PreviewScene.tsx`, removed). Rendered
checks: not performed.

---

# Validation: one-world repair (follow-up to job 463ed97b-9667-4474-8e34-bab88796fae9)

All results below are worker-side, from 2026-11-18 on this machine, against the final production export in `dist/`. The verifier for this job checks paths and bytes only; nothing here is independently certified.

## Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npx tsc --noEmit` (also inside `npm run build`) | exit 0 |
| Unit tests | `cd web && npx vitest run` | 3 files, 46/46 passed (adds `tests/quantity.test.ts`: 1/7/50/" 12 " accepted; 51, 0, 2.5, -3, abc, empty, 1e1, +5, 100, 0x10 rejected) |
| Production build | `cd web && npm run build` | built into `dist/` (vite 5.4, relative `./` asset URLs) |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16/16 checks passed at 320/390/1440 (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion, share). Raw output: `artifacts/taste-probe.json` |
| Browser walkthrough | Playwright 1.49 + headless Chromium 131 (software GL) on the static export, 1440×900 and 390×844 (touch) | table below; raw: `artifacts/walkthrough-results.json`; screenshots: `artifacts/screens/`; recordings: `artifacts/recordings/` |

Chromium needed system libraries this machine lacks; they were unpacked from Ubuntu packages into a temporary folder outside the repository (`LD_LIBRARY_PATH`), nothing was installed system-wide.

## Walkthrough results (final export)

Fixtures are labelled in the page ("Test fixture: N simulated candles, not onchain."). The live run reads mainnet through the site's public RPC fallbacks.

| Step | Recorded result |
| --- | --- |
| d1440 zoomin | `{"frame": {"visibleSectors": 1, "drawnCandles": 12, "lod": 2, "ms": 0.7999997138977051}, "fps": "17"}` |
| d1440 zoomout | `{"frame": {"visibleSectors": 12, "drawnCandles": 100, "lod": 1, "ms": 3.0999999046325684}, "fps": "11"}` |
| d1440 pan-to-bounds | `{"frame": {"visibleSectors": 12, "drawnCandles": 100, "lod": 1, "ms": 7.099999904632568}, "fps": "11"}` |
| d1440 popup before/after pan | `{"a1": {"cls": "detail-wrap anchored", "left": "720px", "top": "420px", "title": "Candle #37", "addr": "0x1111111111111111111111111111111111111111"}, "a2": {"left": "600px", "top": "480px"}}` |
| d1440 map tools hidden with popup | `false` |
| d1440 map tools hidden on light sheet | `true` |
| d1440 qty "51" | `{"help": "At most 50 candles per purchase. Split larger batches.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "invalid": "` |
| d1440 qty "0" | `{"help": "At least 1 candle.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "invalid": "true"}` |
| d1440 qty "2.5" | `{"help": "Use a whole number from 1 to 50: no decimals, signs or letters.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "in` |
| d1440 qty "-3" | `{"help": "Use a whole number from 1 to 50: no decimals, signs or letters.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "in` |
| d1440 qty "abc" | `{"help": "Use a whole number from 1 to 50: no decimals, signs or letters.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "in` |
| d1440 qty "" | `{"help": "1 candle \u00b7 whole numbers from 1 to 50", "total": "Candles1 | Total1 IMD | Your balanceNot connected | ApprovalChecked when you connect | Estimated gas\u2264 0.00006 ETH", "btn": "Light 1 candle", "invalid": "false"}` |
| d1440 qty "50" | `{"help": "50 candles \u00b7 whole numbers from 1 to 50", "total": "Candles50 | Total50 IMD | Your balanceNot connected | ApprovalChecked when you connect | Estimated gas\u2264 0.00093 ETH", "btn": "Light 50 candles", "invalid": "f` |
| d1440 qty "7" | `{"help": "7 candles \u00b7 whole numbers from 1 to 50", "total": "Candles7 | Total7 IMD | Your balanceNot connected | ApprovalChecked when you connect | Estimated gas\u2264 0.00016 ETH", "btn": "Light 7 candles", "invalid": "false` |
| d1440 draft after reload | `{"custom": "7", "wish": "Keep this wish across reloads"}` |
| d1440 overlap check | `["wish-all covered by strip strip-under"]` |
| d1440 route mine h2 | `"My candles"` |
| d1440 route rewards h2 | `"Rewards"` |
| d1440 route treasury h2 | `"Treasury"` |
| d1440 route how h2 | `"How it works"` |
| d1440 f0 overview | `{"frame": {"visibleSectors": 10, "drawnCandles": 0, "lod": 1, "ms": 2.8000001907348633}, "fps": "7"}` |
| d1440 f0 pan fps | `{"frame": {"visibleSectors": 6, "drawnCandles": 0, "lod": 2, "ms": 0.20000028610229492}, "fps": "16"}` |
| d1440 f3000 overview | `{"frame": {"visibleSectors": 50, "drawnCandles": 3000, "lod": 0, "ms": 1.0999999046325684}, "fps": "8"}` |
| d1440 f3000 pan fps | `{"frame": {"visibleSectors": 6, "drawnCandles": 168, "lod": 2, "ms": 9}, "fps": "13"}` |
| d1440 f10000 overview | `{"frame": {"visibleSectors": 128, "drawnCandles": 10000, "lod": 0, "ms": 39.90000009536743}, "fps": "8"}` |
| d1440 f10000 pan fps | `{"frame": {"visibleSectors": 6, "drawnCandles": 168, "lod": 2, "ms": 21.09999990463257}, "fps": "13"}` |
| d1440 live status | `" Sales closed until activation \u00b7 0 lit"` |
| d1440 errors | `[]` |
| m390 zoomin | `{"frame": {"visibleSectors": 1, "drawnCandles": 2, "lod": 2, "ms": 0.3000001907348633}, "fps": "31"}` |
| m390 zoomout | `{"frame": {"visibleSectors": 24, "drawnCandles": 100, "lod": 0, "ms": 0.40000009536743164}, "fps": "34"}` |
| m390 pan-to-bounds | `{"frame": {"visibleSectors": 24, "drawnCandles": 100, "lod": 0, "ms": 0.3000001907348633}, "fps": "4"}` |
| m390 popup before/after pan | `{"a1": {"cls": "detail-wrap", "left": "", "top": "", "title": "Candle #37", "addr": "0x1111111111111111111111111111111111111111"}, "a2": {"left": "", "top": ""}}` |
| m390 map tools hidden with popup | `true` |
| m390 map tools hidden on light sheet | `true` |
| m390 qty "51" | `{"help": "At most 50 candles per purchase. Split larger batches.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "invalid": "` |
| m390 qty "0" | `{"help": "At least 1 candle.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "invalid": "true"}` |
| m390 qty "2.5" | `{"help": "Use a whole number from 1 to 50: no decimals, signs or letters.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "in` |
| m390 qty "-3" | `{"help": "Use a whole number from 1 to 50: no decimals, signs or letters.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "in` |
| m390 qty "abc" | `{"help": "Use a whole number from 1 to 50: no decimals, signs or letters.", "total": "Candles\u2014 | Total\u2014 | Your balanceNot connected | Approval\u2014 | Estimated gas\u2264 0.00004 ETH", "btn": "Enter 1 to 50 candles", "in` |
| m390 qty "" | `{"help": "1 candle \u00b7 whole numbers from 1 to 50", "total": "Candles1 | Total1 IMD | Your balanceNot connected | ApprovalChecked when you connect | Estimated gas\u2264 0.00006 ETH", "btn": "Light 1 candle", "invalid": "false"}` |
| m390 qty "50" | `{"help": "50 candles \u00b7 whole numbers from 1 to 50", "total": "Candles50 | Total50 IMD | Your balanceNot connected | ApprovalChecked when you connect | Estimated gas\u2264 0.00098 ETH", "btn": "Light 50 candles", "invalid": "f` |
| m390 qty "7" | `{"help": "7 candles \u00b7 whole numbers from 1 to 50", "total": "Candles7 | Total7 IMD | Your balanceNot connected | ApprovalChecked when you connect | Estimated gas\u2264 0.00017 ETH", "btn": "Light 7 candles", "invalid": "false` |
| m390 draft after reload | `{"custom": "7", "wish": "Keep this wish across reloads"}` |
| m390 overlap check | `[]` |
| m390 route mine h2 | `"My candles"` |
| m390 route rewards h2 | `"Rewards"` |
| m390 route treasury h2 | `"Treasury"` |
| m390 route how h2 | `"How it works"` |
| m390 f0 overview | `{"frame": {"visibleSectors": 15, "drawnCandles": 0, "lod": 0, "ms": 0.40000009536743164}, "fps": "10"}` |
| m390 f0 pan fps | `{"frame": {"visibleSectors": 4, "drawnCandles": 0, "lod": 1, "ms": 0.20000028610229492}, "fps": "32"}` |
| m390 f3000 overview | `{"frame": {"visibleSectors": 126, "drawnCandles": 3000, "lod": 0, "ms": 17.09999990463257}, "fps": "10"}` |
| m390 f3000 pan fps | `{"frame": {"visibleSectors": 4, "drawnCandles": 74, "lod": 1, "ms": 3.1999998092651367}, "fps": "23"}` |
| m390 f10000 overview | `{"frame": {"visibleSectors": 126, "drawnCandles": 6352, "lod": 0, "ms": 10.400000095367432}, "fps": "11"}` |
| m390 f10000 pan fps | `{"frame": {"visibleSectors": 4, "drawnCandles": 74, "lod": 1, "ms": 3.200000286102295}, "fps": "21"}` |
| m390 live status | `" Sales closed until activation \u00b7 0 lit"` |
| m390 errors | `[]` |

How to read it:
- **Live public reads**: the live page reported "Sales closed until activation · 0 lit" at both widths: the contract is not activated and holds 0 candles. No console errors on desktop; on mobile, one third-party wallet SDK analytics fetch failed (blocked network), with no effect on the page.
- **Selection / lookup**: Find "37" opened Candle #37 with the full owner address. On desktop the popup is anchored to the flame and moved with the map when it was dragged (left/top changed from 720/420 to 600/480 px). On mobile it is a sheet and the map tools are hidden behind it.
- **Zoom / pan / reset / bounds**: wheel zoom in and out, drag pan, and a 2000 px drag toward the edge (the camera clamps to the garden plus a woodland ring), then Reset view. See `d1440-f100-*.jpg`.
- **Quantity edge cases**: 51, 0, 2.5, -3, abc each show a specific error, set `aria-invalid`, blank Candles/Total/Approval and change the button to "Enter 1 to 50 candles". 50 and 7 show identical numbers in the help line, Candles, Total and the button.
- **Wish retention**: after a reload the custom quantity (7) and the wish text were still in the form.
- **Overlap**: on mobile no map tool or strip covers any panel input, wish, summary or button. On desktop the check flagged the wish field as "covered by strip"; that field was below the panel's scroll fold (the panel scrolls above the strip). It is a false positive of the probe, confirmed in `d1440-light.jpg`.
- **Routes**: Light, My Candles, Rewards, Treasury and How it works each opened with the expected heading at both widths.

## Measured performance (headless, software rendering)

`fps` is the page's own counter (frames painted in the last second); `ms` is the CPU time of the last `draw()`. Headless Chromium with SwiftShader has no GPU, so these are lower bounds, not device numbers. From the table above: at 10,000 candles the overview frame (128 cells, all 10,000 candles as cached light layers) took about 40 ms, and close-up panning (6 cells, 168 candles with animated flames) took about 6–21 ms per frame at 11–13 fps headless. On mobile, close-up frames took about 3–5 ms at about 20 fps. No 99% similarity score, Lighthouse score or device frame rate was measured, and none is claimed.

## Purchase, approval and recovery

- Covered by unit tests on labelled mocks (`web/tests/logic.test.ts`, unchanged this round): exact approval amount, approval rejected by the user, purchase rejected, receipt revert, pending-hash recovery after reload, duplicate-click guard, reward claims.
- **Not done this round:** no mainnet fork (anvil) run and no browser wallet transaction. No real or test purchase was made, and none is claimed. Sales are not activated onchain.

## Better Interface review (six domains)

Coverage: guide `.imd/reads/skills/better-interface/REFERENCE.md`, core principles of all six domains; rendered checks done in headless Chromium at 390 and 1440 (screenshots above); contrast measured only by the design probe.

| Domain | Finding | Fix |
| --- | --- | --- |
| Accessibility | Map tools stayed focusable and visible over open panels | `hidden` on the group while a panel/menu is open, or a candle sheet on mobile: `web/src/garden/Garden.tsx:231`, `web/src/App.tsx:201`; CSS guard `web/src/styles.css:437` |
| Accessibility | Invalid quantity was silently clamped | `aria-invalid`, `aria-describedby` and `role="alert"` message: `web/src/panels/LightPanel.tsx:186` |
| Accessibility | No keyboard way back to the opening view | Reset view button with label and the `0` key: `web/src/garden/Garden.tsx:244` |
| Layout | Zoom buttons and minimap covered the purchase form on phones | same `hidden` fix; probe `layout` and `targets` pass |
| Layout | Screen-fixed frames (arch, canopy, right ledge) framed a small garden picture | removed: `web/src/App.tsx:205` |
| Writing | Quantity errors were absent | specific reasons: `web/src/lib/quantity.ts:12`; the button names the problem |
| Writing | No way to copy the full owner address | full address and Copy address with "Copied" feedback: `web/src/panels/Panels.tsx:19` |
| Typography | none new; one six-size scale kept | probe `type-sizes`, `type-faces`, `tracking` pass |
| Colors | Vista palette needed tokens; no purple | `VISTA_TOP` / `VISTA_FOOT` and ridge colours: `web/src/garden/vista.ts:12`; probe `contrast` passes |
| UI | Minimap drew sector tiles, not the world | world minimap (woodland, garden, streams, candles, camera): `web/src/garden/renderer.ts:363` |
| UI | Panels had no in-place Connect action | `ConnectButton` opens the one connect sheet: `web/src/components/ConnectSheet.tsx:132` |

## Revision 2: review findings (2026-11-18)

Reproduced in headless Chromium 131 (Playwright 1.49, software raster) on the committed export, served locally, with the reviewer's exact steps. Each was run before the change (on the previous `dist/`) and again after it. Screenshots after the change: `artifacts/screens/rev2-*.jpg`.

| Finding | Before | Change | After |
| --- | --- | --- | --- |
| Path/stream breaks at sector joins (high) | Reproduced: after the pan, the path ends on a vertical edge at x 693 and resumes offset; at overview the path steps at cell joins, the streams start as flat-topped bands, and a straight per-sector seam and band run along the skyline | `scenery.ts`: `drawSectorBase()` (cell + 4 units, curves clipped to the cell; patches and ground cover wholly inside) and `drawSectorUpright()` (whole sprites, 180 margin). `renderer.ts:draw()`: all flat layers first, then upright layers and candles row by row. Land, skyline haze and mist are drawn once in world space. Home-row streams start at a spring (`springY`) below the skyline | `rev2-d-pan-rd.jpg`: continuous path through x 693. `rev2-d-crop-path.jpg`: no steps. `rev2-d-crop-horizon.jpg`: no seam or band; streams start at springs |
| Popup not clamped vertically (high) | Reproduced: popup box top at y −92 after Find 9876, and −342 after a further pan | `lib/popup.ts:placePopup()`: above or below the flame, within header to strip, avoiding the intro (hidden if it still overlaps); hidden while its flame is under the header. CSS notch flips for `.below` | Find 9876: box at y 354 (below the flame). After the pan: y 124–581, under the 56 px header, with the intro hidden. Unit tests in `web/tests/popup.test.ts` |
| No transaction per candle (high) | Reproduced: the detail had no transaction | `Candle.txHash`, `lib/txhash.ts`: `rememberTx()` from purchase receipts and activity logs; `findCandleTx()` locates the block by `createdAt` and matches `CandlesPurchased` (purchaser topic, `firstCandleId ≤ id < firstCandleId + quantity`). Detail row "Transaction" links to Etherscan `/tx/` | Unit-tested on a simulated chain (`web/tests/txhash.test.ts`). **Live totalCandles is 0** (read 2026-11-18), so no real candle could be looked up; fixtures show "None: simulated candle" |
| Blurred upscale at maximum zoom (medium) | Reproduced: zoom 4 stretched the 0.7× cache | `MAX_ZOOM` 1.8 and a fourth cache tier at 1.0× from zoom 1.15 | `rev2-d-zoomin-stream.jpg`: sharp sprites, the spring with boulders, the stream with banks |
| Mobile Find hides the candle behind the sheet (medium) | Reproduced: the ring sat at the sheet's top edge | `Garden.tsx:jumpTo()` lifts the target to a quarter of the map height under 640 px; the intro hides while the candle sheet is open | `rev2-m-find37.jpg`: ring and candle fully above the sheet |
| Frame rate halves at 10,000 (medium) | Not reproduced as a 2× drop here: idle home view at 1440×900 measured 17.8 fps (fixture 100) vs 14.0 fps (fixture 10000), with `draw()` at 6.7 ms vs 4.8 ms | Flames are now pre-rendered sprites per style, with no per-candle gradient per frame. Reduced motion already skips frames while the camera is idle | 13.5 fps vs 11.7 fps, `draw()` at 2.6 ms vs 4.0 ms. Headless frame rate here is bound by software compositing of the full canvas, not by `draw()`. Overview at 10,000: `draw()` about 50 ms, redrawn only on camera change |

Commands after the last source change: `npx tsc --noEmit` exit 0. `npx vitest run`: 5 files, 55/55 passed. `npm run build`: built. Design probe `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`: 16/16 checks passed (`artifacts/taste-probe.json`).

Better Interface pass on the changed parts. Accessibility: the popup is never placed under the header or over the intro, and the Transaction row is a labelled link. Layout: no text over text, and the popup stays between the header and the strip. Writing: "Transaction unavailable" and "Looking up…" state plainly what is happening. Typography and colors: no new sizes or colors. UI: the notch follows the side the popup is on. Not re-recorded this round: the walkthrough WebM recordings in `artifacts/recordings/` are from the previous round.

## Unresolved findings and limitations

1. **Art (blocker):** no image-generation or illustration tool was available, so no illustrated layers were produced. All scenery is procedural canvas art (now with a procedural vista). It does not match the reference's painterly richness: foliage reads as repeated sprites, there is no sculpted statue, armillary or banner in the world, and the far terraces are simple light points. See `artifacts/screens/side-by-side-*.jpg`. This needs illustrated assets from the requester or a rerun with an image tool.
2. At 10,000 candles the overview shows a regular rhythm: each grid column has one stream and each row one path, so the large-scale pattern looks gridded even though the edges are continuous.
3. Candle → transaction mapping is implemented and unit-tested, but untested against a real candle: none exists onchain yet (totalCandles 0). The lookup needs a public RPC that serves `eth_getLogs` over a window of 81 blocks (2,401 blocks on retry).
4. Reflections are limited to the warm light pools; there is no mirrored flame in the water.
5. Hit testing uses a world-space radius; trees of nearer rows can cover a candle visually while it remains clickable.
6. No fork test or wallet transaction ran (see above). The frame-rate figures are headless lower bounds.
7. The streams' and paths' large-scale rhythm (one stream per column, one path per row) is unchanged; only their joins and heads were fixed.

## Revision 4 (2026-11-18): approved design, verification fixes

Worker-side results; the verifier does not re-run them. Commands in web/ after the last source change: npx tsc --noEmit exit 0 (run by npm run build); npx vitest run 7 files, 78/78 passed (new tests/verify.test.ts, 15 tests: exact-draft calldata/event checks for replacements, bounded sender/nonce/block recovery with binary search and linear fallback, claims never Claimed for cancels/self-transfers); npm run build built dist/. Design-critic probe: see artifacts/taste-probe.json (result printed by the run is recorded in the README).

### Evidence (labelled)
Environment: headless Chromium (Playwright 1.49) in a Linux x86_64 container with software rendering; "mobile" is 390x844 emulation (touch, isMobile), not a physical phone. The export was served by route interception. Fixture runs (?fixture=0/100/3000/10000) are local mock data, labelled in the page, never onchain. The d1440-live shot reads Ethereum mainnet through public RPCs. No fork and no wallet transaction ran. Raw numbers: artifacts/rev4-evidence.json.

- Load (navigation to garden ready): desktop 1.2 s (0), 1.8 s (100), 2.0 s (3000), 2.4 s (10000); mobile 0.85 to 1.2 s.
- JS heap after load: 5.4 to 7.7 MB at all fixture sizes.
- Frame rate (renderer's own counter, software rendering, headless): 9 to 11 fps on desktop while animating; mobile emulation reported no counter because the renderer was idle (no animation frames requested). These are not GPU numbers and are not claimed for real devices.
- Find-to-selection latency: 414 to 542 ms (100/3000), 1024 ms for id 2500 at 10000 on desktop; 414 to 459 ms on mobile.
- Mobile candle sheet vs strip at 390x844 (Find 37 / 2500): sheet bottom 772 px, strip top 780 px, no overlap at every fixture.
- No horizontal overflow at 1440, 390 and 320 on the garden and on all pages (scrollWidth equals the viewport).
- One page error per load: "Failed to execute inlined telemetry script" from a dependency in headless Chromium; it does not affect rendering. Not fixed.
- Screens: artifacts/screens/rev4-*.jpg: wide (fixture wide views), medium (d1440-fixture3000-medium), close (…-close-select), every page at 1440 and 390, Light and How at 320, live. Recordings: artifacts/recordings/rev4-pan-zoom-select-desktop-1280x800.webm and …-mobile-390x844.webm (zoom, drag pan, Find 1234 and 2999 with selection).

### Better Interface review (six domains)
Coverage: the review in this revision used the pinned guide's six domains as a checklist against the changed components, together with the design-critic probe's rendered checks (contrast, targets, type sizes, casing, tracking, chrome, motion, share). The full 217 KB REFERENCE.md was not re-read end to end in this revision because of the turn budget; that is a limitation.
- UI/chrome: web/src/everlight.css:109: the selected style had a border and a glow shadow together (probe "chrome"). Fixed: one border treatment.
- Layout: web/src/everlight.css:110: the sales notice was a card inside the docked card. Fixed: a plain ruled note.
- Writing: web/src/App.tsx:253: the design's "A wish. A flame. A place forever." is a three-fragment slogan; set as one sentence with the same words, followed by one plain line saying what the product is.
- Accessibility: web/src/everlight.css:62: style names are hidden visually in the 7-up row but remain the radio labels for assistive tech. web/src/everlight.css:57: the preview flame stops under reduced motion. Wrong-network controls now offer the switch beside the disabled action (web/src/components/WrongNetwork.tsx) and in the header menu with Disconnect.
- Typography: serif display for headings and controls, sans for running text, sizes from the existing five tokens plus the clamped headline.
- Colors: emerald/black surfaces, antique-gold lines and brass gradients; probe contrast passed.
Rendered checks in a browser tool were not available as an interactive tool; Playwright screenshots stand in for them.

### Limitations (revision 4)
- No image-generation, illustration or 3D tool was available to this worker. The approved design is a painted, cinematic perspective illustration; this site still draws its garden procedurally (top-down terraced map with a parallax vista). It is not claimed to match the reference, and the requested licensed illustrated environment assets were not produced. The vista was repainted (one castle on its own hill, no black rectangle, no tiled duplicate castles, no painted candle-like lights on far terraces), and the chrome now follows the design's composition: header, headline, docked Light your candle form with live candle preview, bottom find/zoom/minimap/split strip.
- Perspective scale continuity between near and far terraces, flowing animated water and illustrated bridges/pavilions remain open.
- Purchases, approvals, replacements and claims are verified by unit tests on labelled mocks only; no fork or live transaction ran.

## Revision 5 (2026-11-18): reopened findings

Environment: Ubuntu 24.04 worker, Node 24.21, Playwright 1 with Chromium headless shell 159 (software rendering). The missing system libraries were extracted from Ubuntu packages into a temporary directory. Everything here is **mock/fixture** evidence; no fork or live transaction ran.

### Commands and results
- `cd web && npx tsc --noEmit`: exit 0
- `cd web && npx vitest run`: 7 files, 86/86 passed. New tests cover: 10,000-position capacity at fixtures 0/100/3000/10000; flame, body and foot hit tests on the 2.1× founding candle; fixture read-only (no deps calls); a nonce/block read failure stops before signing; nonce reconciliation from the sent transaction; preflight nonce and block kept when the sent transaction is unknown; a receipt without its transaction stays pending; a successful different replacement is reported with its hash and ids; a claim whose transaction can't be read is unverified and kept; ignition progress.
- `cd web && npm run build`: built `dist/`, run again after the last source change.
- `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`: 16/16 passed at 320/390/1440 (`artifacts/taste-probe.json`).
- Playwright check of `dist/` (script in `test/scratch`, not shipped): 20/20 passed (`artifacts/rev5-browser-checks.json`).

### Findings
| Finding | Reproduced | Fix | Evidence |
| --- | --- | --- | --- |
| 27761ccb art fidelity | yes | not fixed: no image, illustration or 3D tool available | limitation below |
| c58aa7c5 96 positions at fixture 0 | yes (unit test: `sectorCount(0)` was 1) | `layout.ts` `MIN_SECTORS` = 105 | unit test; at 1440 and 390, fixture 0 zoomed out draws 126–128 cultivated cells (`rev5-*-fixture0-zoomed-out.jpg`) |
| ab06882c sheet over Light form | yes (code path) | `App.tsx` `detailRoute`, `jump` returns to the garden, canvas taps on phones use `jump` | 390 touch: after Find 37 and menu → Light, the detail count is 0 and the form is under (190,550); register #1 → `#/garden`; tapping the flame frames the candle body at y=207, above the sheet top at y=428 |
| 80e6c460 header clipping 320/1101 | yes at 1280 in this browser (1101 was already fixed by the 1279 breakpoint) | `styles.css` breakpoints at 1279; `everlight.css` ≤360 and 1280–1439 rules | 320 with the mock wallet on Base: Wrong network x=232 w=80 right=312, menu right=224; at 1101/1180/1279/1280/1440 every header control is inside the header and the viewport |
| b571f235 fixture can purchase | yes (code path) | `readOnly`, handler guards, disabled CTA and claim, persistent label | 320 mock wallet on chain 1: CTA disabled, force-click gives 0 wallet requests; label visible on all 6 routes |
| 3753abea settles without calldata | yes (unit) | `settleBuy` returns `buy-unknown`, pending entry kept | unit tests in `verify.test.ts` and `logic.test.ts` |
| 72d38a6a missing nonce/block | yes (unit) | metadata required before signing; `reconcileSent`; `completeMeta` on recovery; same for claims | unit tests |
| 4652f06e no ignition | yes | `ignite.ts` and the renderer ignition path; live completion and reload recovery both focus and ignite | unit test; browser: the canvas differs right after `__igniteForTest` (fixture-only hook) |
| 72d73b8a different replacement message | yes (unit) | `differentPurchaseMessage` with the mined hash and ids; the UI links the transaction | unit test |
| 88fc55f0 flame tap | yes (unit at the old radius) | segment hit test | unit test plus a browser tap on the flame at (195,386) |
| 24e84b1c clipped share card | yes | new og.png composition | `web/public/og.png` |

### Better Interface review of the changed surfaces
- Accessibility: the fixture label is a `role="note"` paragraph in the reading order; the wrapped Wrong network button keeps a 44px target and its accessible name; selection changes do not move focus away from the new page.
- Layout: no overlay is left over the page a visitor navigates to; at 320 the header fits without hidden overflow (measured above).
- Writing: the state messages say what happened ("confirmed a different candle purchase", "could not be read … stays saved") and do not claim funds were or were not spent beyond what the receipt shows.
- Typography: no new sizes. The label uses `--text-sm`, and the share card uses the existing serif.
- Colours: the fixture label reuses the existing gold-on-dark accent pair already used by the intro label.
- UI: primary actions are disabled on fixtures, with the reason shown in the problems list.
- Not done: no screen-reader session and no real-device tests.

### Limitations (revision 5)
- The approved painted perspective artwork and licensed illustrated environment assets were still not produced; no image, illustration or 3D tool was available to this worker. Apart from the larger cultivated area, the garden art and the purchase preview are unchanged.
- Performance was measured headless only. With 105 cultivated sectors, the fully zoomed-out overview frame took 48–58 ms in software rendering (`rev5-browser-checks.json`); this was not measured on real devices.

## Revision 6 (2026-11-18): reopened findings

### Commands and results
- `cd web && npx tsc --noEmit`: exit 0.
- `cd web && npx vitest run`: 8 files, 90/90 passed. The new file `tests/nonce.test.ts` has 4 tests.
- Reproduction: the same test file run against `git show HEAD:web/src/lib/chain.ts` failed 2 of 4. The purchase settled as `{name:"error", message: REPLACED_MESSAGE}` and the claim resolved on C's receipt, matching the reviewer's measurement. With the fix, all 4 pass.
- `cd web && npm run build`: built `dist/` with relative `./assets/` URLs.
- `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` (Playwright 1.x, Chromium headless shell 159, system libraries supplied from Ubuntu noble packages in a temp directory): 16/16 passed.
- Playwright pass over `dist/` at 1440×900 and 390×844, fixtures 0 and 100: no page or console errors, `scrollWidth - innerWidth` = 0 on both. Screenshots: `artifacts/screens/rev6-d1440-fixture0-wide.jpg`, `rev6-d1440-fixture100-close.jpg`, `rev6-m390-fixture0-wide.jpg`, `rev6-m390-fixture100-close.jpg`, `rev6-m390-page-light.jpg`, and the preview at both widths (`rev6-*-preview.png`). Measured preview geometry: 1440 stage 330×200, bowl 92×37, candle 80×160; 390 stage 358×168, bowl 74×29, candle 64×128.

### Findings
- 139cd715 (fixed): `web/src/lib/chain.ts:30-57`, `verifiedMeta` and `NONCE_UNVERIFIED`. `web/src/panels/LightPanel.tsx:42` now passes the message through to the form. Test: `web/tests/nonce.test.ts`.
- dcae6c2e (partly addressed, disputed as a whole): `web/src/panels/PreviewScene.tsx` (new), `web/src/everlight.css:47-53` (bowl layers), `web/src/garden/scenery.ts` (stream depth, reflections, lily pads). The painted perspective environment still needs art tools this worker did not have.

### Better Interface review of the changed surfaces
- Accessibility: the preview stage and both bowl layers are `aria-hidden` and `focusable="false"`. The new recovery message is plain text in the existing `role="status"` pending box, next to "Check again".
- Layout: the bowl is sized and placed from the same `--k`/`--ctop` variables as the candle, so it scales at the 900 px breakpoint. There is no overflow at 320, 390 or 1440 (probe).
- Writing: `NONCE_UNVERIFIED` says what happened, what is kept, and what to do next.
- Typography and colours: no new type sizes. The preview uses the existing emerald, brass and ivory family; the gradient ids are unique per layer.
- UI: no new controls.
- Not done: no screen-reader session and no real-device test.

### Limitations (revision 6)
- The approved cinematic perspective artwork was not produced, because no image, illustration or 3D tool was available. The tree sprites (three variants) and the top-down terraced map are unchanged.
- Performance was not re-measured; the scenery change adds per-cell drawing only when a cell is cached.

## Revision 7 (2026-11-19): review findings

Environment: Ubuntu 24.04 worker, Node 24.21, Playwright 1.56 driving Chromium headless shell 1248 (software rendering). Missing system libraries and a font were unpacked from Ubuntu noble packages into /tmp; nothing was installed system-wide. The export was served from `dist/` by a local static server on 127.0.0.1.

Reproduction on the previous `dist/` (before any change):
- f7808a72 (Treasury Retry): reproduced. `Panels.tsx:306` rendered only the `.bad` sentence; no button.
- 26e97d45 (dock collapse): reproduced at 1440×900. `#/garden` had no control that hides the dock (`getByRole("button", { name: "Hide the candle panel" })` count 0).
- 42f8395f (partial scan "none yet"): reproduced by reading `hooks.ts:152-163` (`complete: ... || out.length === 0`, and the panel never read `complete`). After the fix it was checked with mocked RPC (head = deploy + 100,000, empty logs).
- 2126b59e (moon under header): reproduced. (The rev7 captures cited here were never committed; revision 8 replaces them with `evidence/rev8/screens/rev8-before-garden-*.jpg` and `rev8-after-garden-*.jpg`, see below.)
- a08a9397 (headline) and 108a48ec (brand dot): reproduced. h1 "A wish, a flame, a place forever"; brand text "EVERLIGHT GARDEN\n · on IMD".

Checks after the last source change of revision 7 (the raw log was not committed; current raw results are in `evidence/rev8/rev8-browser-checks.json`):

| Check | Result |
|---|---|
| brand at 1440 | "EVERLIGHT GARDEN on IMD" (no dot); 390 shows the name only, as designed |
| h1 at 390 and 1440 | "Every wish leaves a light." |
| horizontal overflow at 390 and 1440 | none |
| hide control in dock | present, 44×44 at (1367, 97) |
| after hide | dock removed; "Light a candle" tab at (1268, 72), 156×44, focused |
| after show | dock back; hide button focused |
| `#/light` after hiding | dock shown |
| Treasury, getLogs forced to HTTP 403 (mock) | "Recent events could not be read. … Try again" |
| click Try again with getLogs answering [] (mock, head = deploy + 100,000) | error gone; "No activity in the last 40,000 blocks (since block 26493360). Older blocks were not scanned here; see the full event history on Etherscan." |
| head = deploy + 1,000 (mock), empty logs | "No purchases, claims or burn jobs yet." |
| page errors / crashes | none |

Opening-view screenshots now delivered: `evidence/rev8/screens/rev8-before-garden-1440.jpg`, `rev8-after-garden-1440.jpg`, `rev8-before-garden-390.jpg`, `rev8-after-garden-390.jpg` (revision 8, see below). The rev7 files named here before were never committed.

Commands: `npm run build` (tsc --noEmit + vite build) exit 0; `npx vitest run` 90/90; `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` 16/16 (`artifacts/taste-probe.json`).

### Better Interface review of the changed surfaces
- Accessibility: the hide button has a text label, `aria-expanded` and `aria-controls`; the tab has `aria-expanded="false"`; focus moves to whichever control replaces the one pressed. Both are 44 px tall. The activity error is `role="alert"`, and its Try again is a real `<button>` that is disabled while fetching.
- Layout: the hide button's negative margin keeps the dock heading centred, and the tab sits where the dock's top edge was. With the dock hidden the headline and toasts widen, and the castle and moon re-centre.
- Writing: the partial-scan message states the range actually read and where to see the rest; it no longer claims there is none.
- Typography and colours: no new sizes or colours; the tab reuses `.cta`, and the hide button reuses `.x panel-x`.
- UI: one toggle, one state, no new pattern.
- Not done: no screen-reader session and no physical device.


## Revision 8: reviewer findings

Environment: Ubuntu 24.04 worker, Node 24.21, Playwright 1 with Chromium headless shell 159 (software rendering). Missing system libraries and DejaVu fonts were unpacked from Ubuntu noble packages into /tmp (nothing installed system-wide, nothing in the repository). The export in `dist/` was served by `python3 -m http.server`. Everything below is **local**: fixture runs (`?fixture=…`) and **mocked** RPC answers by request interception. No live RPC failure was reproduced against the real providers this round, and no wallet transaction ran. Raw results: `evidence/rev8/rev8-browser-checks.json`.

| Check | Kind | Result |
|---|---|---|
| `npm run build` (`tsc --noEmit && vite build`) | local | exit 0, `dist/` rebuilt after the last source change |
| `npx vitest run` | unit | 10 files, 102/102 passed (new: `tests/activity.test.ts`, `tests/stairs.test.ts`, 3 popup cases) |
| taste.mjs at 320/390/1440 | local export | 16/16 passed (`artifacts/taste-probe.json`) |
| Treasury, mock: getLogs > 1,000 blocks returns a range error on all four hosts, head = deploy + 100,000 | mocked RPC | 4 whole-window probes (one per host), then 44 chunks of 50 blocks; stops at the 48-request budget; shows "Verified blocks 26531160 to 26533359 (2,200 blocks). Older events could not be read in this scan (the request limit for one scan was reached). Try again". Try again ran exactly one new 48-request scan (96 total) |
| Treasury, mock: one CandlesPurchased at 26,533,357, then getLogs HTTP 403, Garden for 15.5 s, back to Treasury | mocked RPC | row kept and labelled "Showing activity from the last successful scan, read at 9:31:47 AM through block 26533359. The latest refresh failed…" plus Try again (`screens/rev8-treasury-stale-1440.jpg`) |
| Treasury, mock: every getLogs HTTP 403, no earlier scan | mocked RPC | "Recent activity is unavailable: no RPC host returned these events…" plus Try again; 4 requests, no stacked retries |
| Find #37 at 1440×900, `?fixture=100` after Reset view | fixture | popup placed `side-left` at x 341–661, y 220–679; the ring (centre about x 718) and the candle stay uncovered (`screens/rev8-find37-1440.jpg`) |
| Find #10000 at 1440×900, `?fixture=10000` | fixture | `side-left`, x 340–660 (`screens/rev8-find10000-1440.jpg`) |
| Find #37 at 390×844 | fixture | bottom sheet from y 377; candle framed above it (`screens/rev8-find37-390.jpg`) |
| 1180×900 `#/light`: hide the dock, open the menu, click Light a candle | local | hash stays `#/light`, dock count 0 → 1, menu closed (`.nav.open` count 0) |
| Opening view before/after, fresh storage, `?fixture=0`, Reset view | local | `screens/rev8-before-garden-1440.jpg` / `rev8-after-garden-1440.jpg`, `rev8-before-garden-390.jpg` / `rev8-after-garden-390.jpg`. "Before" is the previous commit's export, "after" is this one, same fixture and camera. After: the twin arches stand on a plinth with a central flight and a flagstone walk down to the diagonal path, and terrace ends carry flights of steps, one with a walk to the path |
| Share card | local | `web/public/og.png` regenerated at 1200×630 from the current empty pixel garden (`?fixture=0`) with the same title and subtitle; copied to `dist/og.png` by the build |

Findings and fixes (`file:line` at the time of the fix):
- 98da2143 (Treasury ranges): `web/src/lib/activity.ts` is a new budgeted scanner. It asks one client per host with no transport retries (`web/src/config.ts` `ETH_LOG_CLIENTS`) and remembers each host's range limit, archive refusal or network failure. It narrows to 50-block chunks, keeps the verified contiguous range from the head, and reports why it stopped. `useActivity` sets `retry: false` (`web/src/hooks.ts`).
- 9e751e88 (stale activity): `web/src/panels/Panels.tsx` now shows distinct unavailable, stale (with time and last scanned block), partial and complete states.
- 39b17bc7 (popup over candle): `web/src/lib/popup.ts` takes the selection ring from `Garden.tsx`. It keeps above and below placements 8 px plus the pointer clear of the ring, then tries the right side, then the left, moving the pointer to that edge. If no side fits, it caps the height to the band above or below the ring and scrolls (`styles.css` `.side-left`, `.side-right`, `.capped`).
- f5509442 (stairs): `web/src/garden/scenery.ts` `stairsOf`/`drawStair`/`drawWalk`/`drawPlinth`. Slots are untouched, and `tests/stairs.test.ts` checks that every flight is clear of every slot's holder-to-flame box across all 105 initial sectors. Holders sit about 28 world units apart and are 24 wide, so no flight fits between two holders; flights stand at terrace ends past the last holder instead.
- e1062a1a (menu dock): the menu link handler closes the menu and reopens the dock (`web/src/App.tsx`).
- ecc4b6c2 (share card) and 81d293c6 (missing screenshots): fixed as listed above.

Better Interface review of the changed parts:
- Accessibility: the stale and unavailable notes use `role="alert"`, and Try again is a real button that is disabled while scanning.
- Writing: the notes say what was read and what was not, with no fabricated zeros.
- Layout: the side popup keeps the candle in view.
- Colors: the stale note uses the existing headline ivory with a gold rule.
- Typography and UI tokens are unchanged.

Not rendered: contrast of the new stale note was not measured separately.

Untested this round: every wallet action (connect, approve, purchase, claim, replacement or cancellation), because no wallet runs in this environment. Also untested: the live providers' current getLogs behaviour, which is covered only by the mock reproducing the reviewer's reported answers.
