# Revision 9 validation: four review findings + garden visual pass

Commit: see `git log` (this job's commit on top of 75c516f). Site: https://everlight.imd.site/ (the plane pins the committed `dist/`; this job ran no publish command).

## What changed

| Finding | Fix | Source | Regression tests |
|---|---|---|---|
| 1. purchase.ts cleared the intent when `deps.buy` threw | The intent is released only for a **proven rejection** (EIP-1193 4001 / `UserRejectedRequestError`, or a wagmi pre-flight error thrown before the wallet is asked). A 4900/4901 disconnect, timeout or unknown error returns `buy-unknown` with the intent kept and the draft locked. `runPurchase` also refuses while any buy entry or intent is saved (reload/reconnect/other tab). Intents resolve by account, chain 1, garden target, nonce (saved nonce up to 8 later ones) and exact `buyCandles` calldata; "not found" requires every used nonce accounted for **and** nothing pending, and even then only offers a release that the user must confirm. Users can paste a transaction hash; it is validated (account, chain, target, nonce, calldata) before it replaces the intent. | web/src/lib/purchase.ts:368, web/src/lib/intent.ts:102, web/src/lib/chain.ts:44, web/src/panels/LightPanel.tsx:469 | `web/tests/revision9.test.ts` › finding 1 (broadcast-then-4900 + reload, timeout vs 4001, resolution by nonce/calldata, hash reconciliation) |
| 2. Claims were sent before an intent was recorded | `runClaim`: no saved/uncertain claim for the account → storage preflight → simulate → nonce/block → **exclusive, read-back persist of the claim intent** (per-account key, Web Lock across tabs) → only then the wallet. Storage failure sends nothing. Ambiguous wallet failures keep the intent (`uncertain`); a failed hash save keeps the earlier intent. Locks are per account and survive network changes and reloads; a `storage` event refreshes other tabs. A pending/uncertain claim disables Claim and shows Check again / paste hash / confirmed release. | web/src/lib/claim.ts:47, web/src/panels/Panels.tsx:205, web/src/lib/purchase.ts:43 | finding 2 (storage quota, intent present when wallet asked, 4900 + reload, other account not locked, two tabs, hash save failure) |
| 3. Loaded-record count shown as total lit | Headline is the contract's `totalCandles` ("N lit"); loaded records are shown separately ("loaded X of Y"), "(incomplete)" with **Retry** when records fail; unknown total is "Total lit: unavailable", never 0. | web/src/lib/counts.ts:10, web/src/App.tsx:311 | finding 3 (partial RPC failure via CandleStore: 250 lit, loaded 100 of 250, incomplete; unknown ≠ 0) |
| 4. "Nothing was sent" after a confirmed approval + gas re-plan | Approval tracked separately (`approval: {hash, allowance}` on the error step). The panel shows **"Approval confirmed; candle purchase not sent."**, the approval receipt link, the allowance read after it and the revised total; the message never says "Nothing was sent". The revised purchase needs a fresh button press; an allowance that already covers it is not approved again. | web/src/lib/purchase.ts:343, web/src/lib/errors.ts:10, web/src/panels/LightPanel.tsx:386 | finding 4 (approval-then-replan: message, approval/allowance, second run makes no second approval) |

## Commands and results (run on this machine)

- `cd web && npm ci` — ok.
- `npx tsc --noEmit` — exit 0.
- `npx vitest run` — **13 files, 131 tests passed** (12 new in `tests/revision9.test.ts`). Full log: `artifacts/rev9/vitest.txt`.
- `npm run build` (tsc + vite build, base `./`, outDir `../dist`) — ok; `dist/index.html` uses relative `./assets/...` URLs.
- Browser run (Playwright 1.56 driving the cached Chromium headless shell, export served locally): `artifacts/rev9/browser-results.json`, screenshots `artifacts/rev9/screens/*.jpg` at **1600x1000 (`d-*`)** and **390x844 (`m-*`)**:
  - labelled fixtures `?fixture=0|100|3000|10000`: headline reads 0 / 100 / 3,000 / 10,000 lit; no horizontal overflow at either width.
  - water animates at 0 candles (canvas changed over 700 ms: true at 0, 100, 3000, 10000); with `prefers-reduced-motion: reduce` the frame is still (false).
  - Find 37 opens the Candle #37 detail beside its slot (`d-fixture100-find37.jpg`, `m-fixture100-find37.jpg`).
  - Pan/zoom by keyboard (+ ×3, ArrowRight ×4): `*-fixture100-panzoom.jpg`.
  - All pages: Light, My Candles, Rewards, Treasury, How it works at both widths.
  - Each page logged one failed request for the document URL itself in this sandbox (a harness artifact of the local server); no page errors.
- Design probe `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`: **all 16 checks passed** (render, layout, targets, contrast, casing, tracking, eyebrows, type-sizes, type-faces, glyphs, slogans, repetition, copy-budget, chrome, motion, share). `artifacts/rev9/taste-probe.json`. 45 text boxes over the canvas were not contrast-measured by the probe.

### Live read-only vs mock

- **Live, read-only:** `eth_call totalCandles()` on the Ethereum garden 0x33a5…30a5 through an Ethereum RPC returned 0 at the time of the run; the live page (`*-live.jpg`) reads "0 lit" from the contract and "Sales closed until activation". No transaction was signed or sent.
- **Mock only:** every purchase/claim/approval test uses labelled in-memory storage, a mock wallet and mock chain reads. No fork, no wallet, no funds.

## Better Interface review (six domains)

Coverage: the new recovery, reconciliation, approval and count UI plus the scenery changes; the rest of the site was reviewed in earlier jobs and re-measured by the probe above.

- Accessibility: the hash field has a visible `<label>` and `aria-describedby` for its result (web/src/panels/LightPanel.tsx:80); recovery/approval states use `role=status`/`role=alert`; release needs a second explicit confirmation. Fixed: the input and Match button use 44px minimum height with a gold focus ring (web/src/everlight.css:163).
- Layout: new boxes reuse the panel's grid gap and left gold rule; probe reports no overflow at 320/390/1440.
- Writing: fixed the contradictory "Nothing was sent" after an approval (errors.ts `afterApproval`); counts say "unavailable" rather than 0; release copy states the double-spend risk plainly.
- Typography: no new sizes; the probe counts 2–3 sizes in regular use.
- Colors: black/emerald surfaces, ivory text, gold accents; danger uses the existing coral token. Ground re-tuned to one quiet dark emerald with haze toward the skyline.
- UI: one primary action per state (Light / Claim disabled while anything is pending or uncertain).

Limitations: contrast over the canvas is not measured; no screen-reader run was performed.

## Garden visual pass and remaining gaps (disclosed)

Done this job: quiet dark ground (texture noise removed, web/src/garden/scenery.ts:87), atmospheric haze toward the skyline, wider river with irregular earth-and-moss banks, wet edge line, depth shading and sky-reflection streaks (web/src/garden/scenery.ts:68), restrained amber glow (web/src/garden/renderer.ts:456), fewer scattered flower sprites. Slot coordinates (10,000 stable slots, Find/minimap mapping) are unchanged and the existing layout tests pass.

Not done in this run's time budget, carried as open items: a redrawn sprite set with new flowered arches and mossy-stone detail, varied willow-cluster species, a new bridge and four distinct terrace arrangements beyond those already in the layout, and new frog vignettes (the existing original frog sprites from `web/public/art/px/LICENSE.md` remain). Unpurchased slots stay unlit; only the verified total and verified records light candles.
