# Everlight Garden

**Current revision (2026-11-19): 16-bit pixel-art garden.** See `DESIGN.md` (top section) and `artifacts/validation.md` (top section).

## Install, preview, rebuild
```
cd web
npm ci                              # install from package-lock.json
node art-src/pixel/build.mjs        # (optional) regenerate pixel assets into public/art/px
npm run build                       # tsc --noEmit + vite build -> ../dist (relative ./ URLs)
npm run preview                     # serve the export locally
npx vitest run                      # unit tests
```
The committed `dist/` is the static export the host serves; it has no backend.

## Results of this revision
`tsc --noEmit` exit 0; `vitest` 90/90 passed; `npm run build` ok. **The browser walkthrough and design probe
did not run.** Headless Chromium on the build machine crashed the garden tab. That is an open, undiagnosed
defect, so this revision has no screenshots or performance numbers. Details: `artifacts/validation.md`.

---

# Everlight Garden

A wallet-connected static website for the **existing** Everlight Garden contracts. It renders a midnight garden in which every paid candle permanently lights its own position. Visitors can browse, search and read candles without a wallet. Holders can light candles with IMD on Ethereum, list their candles, claim rewards and inspect the treasury and the cross-chain burn stages.

This repository contains only a website. It deploys no contract, token or NFT, and it never sends owner transactions.

## Contracts (read from the pinned source)

Source of truth: `identity-md-launches/launch-3281-everlightgarden-everlighttreasury-everli` at commit `f3ae2915b2fc99c56079da2fc9addef2e94397e0`. The full inherited ABI (`WishGarden → EverlightBridgeQueue → WishGardenTreasury → GardenEconomy`, Ownable2Step, ReentrancyGuard) is in `web/src/abi/WishGarden.ts`, exported from that commit's `docs/abi/WishGarden.json`. The Base receiver ABI is in `web/src/abi/EverlightBurnReceiver.ts`.

| Role | Chain | Address |
| --- | --- | --- |
| Garden and treasury | Ethereum (1) | `0x39e55288f5b84dd867a784c95f110818ea8f3b31` |
| IMD | Ethereum (1) | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| Burn receiver | Base (8453) | `0xb525358f3f1c531522a27092e8aa1c054bb963fc` |
| IMD | Base (8453) | `0xFF0C532FDB8Cd566Ae169C1CB157ff2Bdc83E105` |
| Owner | | `0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9` |

Live state read on 2026-11-17 at block 26,433,432: `activated = false`, `purchasesPaused = true`, `totalCandles = 0`, `baseReady = true`, `owner` matches. The site reads these flags live. While sales are closed, purchasing is disabled with an explanation, and reads and claims stay available.

## Layout

```
web/                 Vite + React + TypeScript source (package.json, package-lock.json)
  src/config.ts      addresses, chains, public RPC failover, wagmi config
  src/abi/           ABIs from the pinned commit
  src/garden/        deterministic layout, canvas renderer, garden component
  src/lib/           candle store (paged reads + cache), purchase state machine, wish limits, errors
  src/panels/        Light a candle, My candles, Rewards, Treasury, How it works, candle details
  src/components/    wallet connect sheet (EIP-6963 + Coinbase + open-in-wallet links)
  src/garden/layout.ts   continuous landscape geometry: winding streams/paths, curved terraces, slot positions, hit test
  src/garden/scenery.ts  procedural sector scenery (terraces, stream, pools, waterfall, bridge, pedestals)
  art-src/           procedural painter (paint.js) and WebP generator (generate.mjs) for every scenery asset
  public/art/        generated WebP scenery layers and sprites, seven candle styles (CC0, see LICENSE.md there)
  tests/             vitest unit tests (labelled mocks and fixtures)
dist/                committed production export (relative URLs, base "./")
DESIGN.md            implemented design system
artifacts/validation.md  checks run, results and limitations
artifacts/asset-manifest.md  every asset, its layer and its provenance
artifacts/screens/   browser screenshots (1440 / 390, fixtures, live) and reference side-by-sides
artifacts/recordings/ desktop and mobile walkthrough recordings (WebM)
```

## Install, preview, rebuild

Requires Node 20+ (built with Node 24.21, npm 11.19).

```sh
cd web
npm ci                 # install exact locked dependencies
npm run dev            # local dev server
npm run typecheck      # tsc --noEmit
npm test               # vitest: wish limits, quantity 1-50, paging, layout, purchase flow on mocks, escaping
npm run build          # typecheck + vite build into ../dist (emptied first)
npm run preview        # serve the built export locally
```

`dist/` is a static export. Serve it from any static host, IPFS gateway subpath or ENS name; all asset URLs are relative, and pages use hash routes (`#/light`, `#/mine`, `#/rewards`, `#/treasury`, `#/how`).

### Regenerate the artwork

The scenery is original procedural artwork: no image-generation model or illustration tool was available for this job (an unresolved blocker; see `artifacts/validation.md`). The vista is drawn at runtime by `web/src/garden/vista.ts`. To repaint the sprite assets:

```sh
npm i --prefix /tmp/art @napi-rs/canvas
CANVAS_MODULE=/tmp/art/node_modules/@napi-rs/canvas/index.js node web/art-src/generate.mjs   # writes web/public/art/*.webp
cd web && npm run build
```

### Test fixtures (no chain writes)

- `?fixture=0`, `?fixture=100`, `?fixture=3000`, `?fixture=10000` replace live candles with a deterministic local fixture, shown with a "Test fixture … not onchain" label. The fixture includes HTML/script wishes, RTL, CJK, emoji and 280-character wishes to exercise escaping and layout.
- `?noassets=1` points the art loader at a missing folder to exercise the drawn fallbacks.

## How it works

- **Reads**: `totalCandles`, then `getCandles(firstId, ≤100)` page by page. Only new ids are fetched on each 30-second refresh. Records are cached in `localStorage` and each page streams into the garden as it arrives. `candleIdsOf(owner, offset, 100)` pages My Candles. Status, rewards and treasury use Multicall3 through viem's `fallback` transport over four keyless Ethereum RPCs and three Base RPCs. Treasury events use bounded `getLogs` windows of 5,000 blocks, at most 8 windows, never before the deployment block 26,433,359.
- **Purchase**: check live sales flags, balance, allowance and ETH. Approve exactly `quantity × 1 IMD` if the allowance is short, wait for that receipt, simulate `buyCandles(styles, wishes)`, then request the purchase. Candles appear only after a successful receipt. Pending hashes are saved in `localStorage` and re-attached after a reload. A ref guard blocks duplicate clicks.
- **Wishes**: optional, public and immutable. The client enforces both 280 Unicode code points and 1120 UTF-8 bytes, and rejects lone surrogates, mirroring `Utf8Wish.validate`. A privacy acknowledgement is required before any wish is sent. Wishes render as React text nodes, never as HTML.
- **Gas**: the estimate uses the contract docs' bound `300,000 + 170,000 × candles + 1,300 × wish bytes`, times the live gas price (plus about 60,000 gas for an approval). Batches over the EIP-7825 cap of 16,777,216 gas are blocked with a request to split them.
- **Scene layers (one world)**: a procedural distant vista (`vista.ts`: sky, moon, ridges, castle), the only parallax layer, seated on the world skyline. Below it, one world-aligned ground fill, then grid cells drawn back to front by row: garden cells (terraces, stone holders, gazebo, lanterns, frogs) and wild woodland cells that continue the same streams, paths, pools and bridges. Each row's purchased candles and their additive light are drawn after that row's cells, from contract data only, so nearer scenery occludes them. Then comes the UI. Nothing scenic is fixed to the screen. At zero purchases every pedestal is empty and nothing is lit except the fixed decorative castle windows and lanterns. Those are boxed and steady, never flames.
- **Garden**: one canvas and one camera showing one continuous landscape (camera bounds, Reset view, a world minimap): winding streams and paths that run through every sector, and curved terraces with seeded, irregular arcs. Positions are deterministic per candle id; sectors of 96 holders grow in half-rings south of the home row, with no cap. It uses viewport culling and three LODs: cached low-resolution sector art with cached per-sector light layers, sprites, and sprites with animated flames. Empty stone holders mark unsold places. Zoom, pan, pinch, keyboard, minimap, find by id, My candles rings and a paged candle register keep every candle reachable.

## Licenses

- Source code: MIT.
- Art in `web/public/art/`, `web/public/favicon.svg` and `web/public/og.png`: original work for this site, CC0 1.0. The scenery is procedurally painted by `web/art-src/paint.js`, and the provenance is in `artifacts/asset-manifest.md` (copied to `web/public/art/LICENSE.md`). `og.png` is a screenshot of the export.
- Wallet marks in `web/src/components/walletIcons.ts`: the vendors' marks, as shipped by RainbowKit 2.2.11 (MIT), used only to identify each wallet.
- Fonts: none bundled. The site uses system serif and sans stacks.
- npm dependencies keep their own licenses (React, wagmi, viem, TanStack Query: MIT).

## Validation

These are worker-side results from 2026-11-18. The full record is in `artifacts/validation.md`.

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 7 files, 86/86 passed (revision 5) |
| `npm run build` | built into `dist/` |
| design-critic probe `taste.mjs` | 16/16 checks passed at 320/390/1440 |
| Playwright walkthrough of the export (live reads plus `?fixture=0/100/3000/10000`, 1440 and 390 wide) | zoom/pan/bounds/reset, Find and the anchored popup, quantity edge cases, draft kept after reload, all routes, map tools hidden behind sheets; frame times measured headless (`artifacts/walkthrough-results.json`) |

| Revision 2 reproduction script (`test/scratch`, not shipped) on the export | the reviewer's steps, before and after: path/stream joins at overview and after a pan, spring heads, popup after Find 9876 and pans, maximum zoom, mobile Find 37, idle frame rate at 100 and 10,000 (see `artifacts/validation.md`, "Revision 2") |

Evidence: `artifacts/screens/` (revision 2 shots are `rev2-*.jpg`) (screenshots and reference side-by-sides) and `artifacts/recordings/` (desktop and mobile walkthrough WebM).

### Revision 3 (2026-11-18): review findings

Commands, run in `web/` after the last source change: `npx tsc --noEmit` exit 0; `npx vitest run` 6 files, 63/63 passed (adds replacement, receipt-verification and reload-recovery tests and `tests/receipt.test.ts` with ABI-encoded logs); `npm run build` built into `dist/`; design-critic `taste.mjs` 16/16 passed at 320/390/1440.

Browser reproduction (headless Chromium, `test/scratch`, not shipped; results in `artifacts/revision-findings-results.json`). The export was served by route interception; purchases ran against a **labelled mock JSON-RPC and an injected EIP-6963 test wallet**, not a chain, fork or real funds.

| Finding | Result after the fix |
| --- | --- |
| Split sheet vs zoom tools, 390×844 touch, `?fixture=100` | with the sheet open the map tools are hidden; `elementFromPoint` at three points of each of the five rows (Founder at y=734.5–760) returns the split list; tools return when it closes |
| Replacement without a purchase (B = 0xc3…, zero-value self-transfer, no logs) | stays on Light a candle with "cancelled or replaced" error; wish and quantity kept; no pending hash |
| Sped-up purchase (B carries the garden `CandlesPurchased` for 1–3) | candles 1–3 link to B, not the sent hash A; draft cleared |
| Reload while A has no receipt | draft locked (`fieldset disabled`), action disabled, pending link shown; a forced click sends nothing (1 `buyCandles` call in total); when B is mined the toast links B, the draft clears and the form unlocks |
| Find 37 at 390×844 and 768×844, Find 31 at 390×568 | ring 159–255 px vs sheet top 376 px; at 390×568 ring 113–200 px vs sheet top 274 px; all clear of the header |
| Desktop popup after Find 9876 and the reviewer's drags | hidden at ring y=16 and y=−84 (no detached box), visible again beside the flame when it returns (y=316) |
| Bridge at z=1.8 | the flagstone deck now spans the stream along the path and meets both approaches; the sprite's deck line sits on the walk's front edge and the stream shows only through the arches (screenshot checked by eye) |

**Limitations.** The art is procedural, not illustrated: no image-generation tool was available. It is not claimed to match the reference, and no similarity score was measured. No fork test or real wallet transaction ran; purchase, approval rejection, replacement and recovery are covered by unit tests and a browser harness on labelled mocks only, so live purchasing is not claimed. Approval rejection was not re-run in the browser in this revision. Hosting is done by the publishing plane from the committed `dist/`.

### Revision 4 (2026-11-18): approved design and verification fixes

What changed:
- **Layout from the approved design**: header with Garden / My Candles / Rewards / Treasury / How it works and an outlined gold Connect wallet; the headline "A wish, a flame, a place forever" with one plain line; at 1180 px and wider the **Light your candle** form is docked on the right (live candle preview with a CSS flame, seven equal-price styles in one row, wish, public-and-permanent note, quantity 1/5/10/Custom within 1–50, Total, the approval → purchase → verified-receipt stages, "Ethereum · gas paid separately", cost details). Narrower screens open the same form as a sheet. The candle popup leads with the wish (as text, never HTML).
- **Vista repainted** (`web/src/garden/vista.ts`): one castle on its own hill, drawn once (wide screens no longer repeat it), no black rectangle under it, no painted candle-like lights on far terraces (only data-driven candles are lit), moon placed under the header, moonlit empty stone terraces and a waterfall.
- **Replacement purchases** are verified against the exact signed draft: the mined (possibly replacement) transaction must be `buyCandles` from the buyer with identical styles and wishes, and the garden's `CandlesPurchased` and `CandleCreated` events must match quantity, ids, styles and wishes (`web/src/lib/purchase.ts`, `web/src/lib/receipt.ts`).
- **Bounded recovery after reload**: each sent purchase/claim saves sender, nonce and the submission block with its draft; after a reload `web/src/lib/recovery.ts` finds the transaction that consumed that nonce (binary search on historical nonces, falling back to a linear scan of at most 600 blocks) and verifies its receipt and events.
- **Claims**: shown as Claimed only when the mined transaction is this account's `claimRewards()` to the garden and the garden emitted `RewardsClaimed` for it; a cancel or self-transfer never shows Claimed (`settleClaim`).
- **Wrong network**: a Switch to Ethereum control beside each disabled action (`web/src/components/WrongNetwork.tsx`) and a header menu with Switch and Disconnect.
- **Mobile**: the candle sheet sits above the strip (measured: no overlap at 390×844); no horizontal overflow at 320.
- Share image `og.png` regenerated from the empty (fixture 0) garden: no invented candles.

Validation (worker-side, after the last source change): `npx tsc --noEmit` exit 0; `npx vitest run` 7 files, 78/78 passed; `npm run build` built `dist/`; design-critic `taste.mjs` 16/16 passed at 320/390/1440 (`artifacts/taste-probe.json`). Playwright evidence for fixtures 0/100/3000/10000, every page, live reads, load/heap/fps/latency and pan-zoom-select recordings: `artifacts/rev4-evidence.json`, `artifacts/screens/rev4-*`, `artifacts/recordings/rev4-*`; details and environment names in `artifacts/validation.md` ("Revision 4").

**Limitations.** No image-generation, illustration or 3D tool was available to this worker, so the painted, cinematic perspective garden of the approved design was **not** reproduced: the garden is still the procedural top-down terraced map with a repainted parallax vista, and no licensed illustrated environment assets were added. Frame rates were measured in headless software rendering, not on real devices. Purchases, replacements and claims are tested on labelled mocks only; no fork or live transaction ran.

### Revision 5 (2026-11-18): review findings

What changed (source references are in `artifacts/validation.md`, "Revision 5"):
- **10,000 empty holders from the start**: `sectorCount()` (`web/src/garden/layout.ts`) never drops below `MIN_SECTORS` = 105 sectors × 96 = 10,080 positions, so scenery, minimap, camera bounds and hit testing cover every holder before any purchase. Holders stay unlit until a confirmed record fills them; past 10,080 the garden still grows one sector ahead. This is visual capacity only; the contract's supply rules are unchanged.
- **Candle details only over the garden**: navigating to another page closes the selection; Find, the register and My Candles focus actions return to `#/garden` first; on phones a canvas tap uses the same framing as Find, so the sheet never covers the candle (`web/src/App.tsx`).
- **Header**: the tabs stay in the menu up to 1279 px and use tighter padding from 1280 to 1439 px; at 360 px and below the header uses 8 px gaps, a fixed 44 px menu button, and "Wrong network" wraps to two lines inside 80 px.
- **Fixtures are read-only**: a persistent "Test fixture … transactions disabled" label on every fixture page; purchase, approval and claim handlers refuse to run (`readOnly` in `runPurchase`, plus guards in `LightPanel` and `RewardsPanel`).
- **Exact verification**: a purchase is settled only once the mined transaction itself has been read. Its sender, the garden as target, the exact `buyCandles` styles and wishes, and the matching events all have to check out. If that transaction can't be read, the purchase stays pending and the draft stays locked, and verification can be retried. A successful replacement that bought different candles is reported as such, with its hash and ids. It is never described as a no-spend cancellation.
- **Recovery metadata**: the nonce and submission block are read before the wallet signs. If that read fails, nothing is sent. The preflight nonce is then reconciled with the sent transaction (read by its hash) and saved. Recovery after a reload re-reads it, and estimates a bounded block for older entries that lack one. Claims follow the same steps, and a claim whose transaction can't be read stays saved without being shown as Claimed.
- **Ignition**: once a purchase receipt and its events are verified (live or after a reload), the garden focuses the first new candle. Each new candle then lights once, from unlit wax through a spark, a growing flame and a bloom, to a steady glow (`web/src/garden/ignite.ts`, `renderer.ts`). Under reduced motion it appears already lit. Fixture loading and cached records never trigger the animation.
- **Hit testing** covers each candle's whole holder-to-flame-tip segment with a minimum touch radius of 22 CSS px, and the closest candle wins, so tapping the founding candle's flame selects it.
- **Share card** `og.png` is a 1200×630 card made from the empty garden plus the wordmark and one line of description. It has no controls and no live status or counts.

Validation (worker-side, after the last source change): `npx tsc --noEmit` exit 0; `npx vitest run` 7 files, 86/86 passed; `npm run build` built `dist/`; design-critic `taste.mjs` 16/16 passed at 320/390/1440 (`artifacts/taste-probe.json`); a Playwright check of the export ran 20/20 checks in Chromium headless shell 159 (`artifacts/rev5-browser-checks.json`, screenshots `artifacts/screens/rev5-*.jpg`). That browser check used a labelled mock EIP-6963 wallet that rejects any send; no transaction ran.

**Limitations (revision 5).** The garden art is unchanged apart from the larger cultivated area. No image-generation, illustration or 3D tool was available, so the approved painted perspective artwork and licensed detailed stone/brass/wax/foliage assets were still not produced. The garden remains the procedural terraced map with a parallax vista, and the purchase preview is unchanged. The ignition check in the browser uses a fixture-only test hook (`window.__igniteForTest`), not a real purchase.

### Revision 6 (2026-11-18): review findings

What changed:
- **Replacement recovery uses only a verified nonce** (finding 139cd715, `web/src/lib/chain.ts`). The saved sender and nonce drive the bounded replacement search only when `verifiedMeta(tx)` holds: `nonceChecked` is true because they were read from the submitted transaction itself, by its hash. A preflight nonce that was never confirmed is not searched by. Only the sent hash's own receipt counts, which viem's `waitForTransactionReceipt` follows to a replacement only after it has read the sent transaction. If that never arrives, `settleReceipt` throws `NONCE_UNVERIFIED`. The purchase then stays `buy-unknown`, its hash, exact draft and submission block stay saved, the form stays locked, and "Check again" retries. Claims recovered after a reload go through the same `settleReceipt`, so an unrelated transaction can never mark them Claimed or settle them. Live claims already use `waitForTransactionReceipt` on their own hash.
- **Purchase preview set** (`web/src/panels/PreviewScene.tsx`). This replaces the flat plate under the candle. It has a moonlit back layer with foliage, jasmine, faint pavilion arches, a moon and a carved stone ledge in perspective. The engraved brass bowl is drawn in two layers, so the candle sits inside it.
- **Water** (`web/src/garden/scenery.ts`): lit shallows over a darker channel, bank reflections, a wet-stone waterline, silver glints, ripple rings and lily pads, some flowering. These are still world-space curves, so cells join without seams.

Validation (worker-side, after the last source change): `npx tsc --noEmit` exit 0; `npx vitest run` 8 files, 90/90 passed. That includes the new `web/tests/nonce.test.ts`, which reproduces the reviewer's scenario with the real chain, recovery and purchase modules and only the Ethereum client's reads mocked. Against the previous `chain.ts` it fails with the reported result (`REPLACED_MESSAGE`, pending list emptied). With the fix it returns `buy-unknown` / `NONCE_UNVERIFIED` and keeps A saved. Further results: `npm run build` built `dist/`; design-critic `taste.mjs` 16/16 passed (`artifacts/taste-probe.json`); a Playwright pass over the export at 1440×900 and 390×844 in Chromium headless shell 159 had no console or page errors and no horizontal overflow (screenshots `artifacts/screens/rev6-*`). All of this is labelled mock or fixture evidence; no fork or live transaction ran.

**Limitations (revision 6).** No image-generation, illustration or 3D tool was available to this worker. The painted, cinematic perspective environment of the approved design is therefore still not produced. That means no large carved foreground steps receding to one castle valley, and no licensed illustrated stone, brass, foliage or pavilion assets. The garden remains the procedural terraced map with a parallax vista, and its trees still come from three sprites. The revision improves the preview and the water only. Closing the gap needs a worker with image or 3D tools, or illustrated layers from the requester. The renderer accepts replacements under the same sprite names in `web/public/art/`, and the vista through `makeVista()`.
