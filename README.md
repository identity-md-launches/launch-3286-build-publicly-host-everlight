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
artifacts/screens/   browser screenshots (1600 / 390, fixtures) and reference side-by-sides
```

## Install, preview, rebuild

Requires Node 20+ (built with Node 24.21, npm 11.19).

```sh
cd web
npm ci                 # install exact locked dependencies
npm run dev            # local dev server
npm run typecheck      # tsc --noEmit
npm test               # vitest: wish limits, paging, layout, purchase flow on mocks, escaping
npm run build          # typecheck + vite build into ../dist (emptied first)
npm run preview        # serve the built export locally
```

`dist/` is a static export. Serve it from any static host, IPFS gateway subpath or ENS name; all asset URLs are relative, and pages use hash routes (`#/light`, `#/mine`, `#/rewards`, `#/treasury`, `#/how`).

### Regenerate the artwork

The scenery is original procedural artwork: no image-generation model was available for this job. To repaint it:

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
- **Scene layers**: a screen-space vista (`backdrop.webp`, with slight parallax), then per-sector scenery cached as one canvas each (`scenery.ts`: textured terraces with stone retaining walls, a moonlit stream that drops in a waterfall at every terrace, bridges, gazebo, trees, shrubs, decorative lanterns and the weathered pedestals that hold candles). Next come the purchased candles and their additive light, drawn per frame from contract data only, then the HTML foreground frames (arch, banner, brass frogs, flowers; `pointer-events: none`) and the UI. At zero purchases every pedestal is empty and nothing is lit except the fixed decorative castle windows and lanterns. Those are boxed and steady, never flames.
- **Garden**: one canvas showing one continuous landscape: winding streams and paths that run through every sector, and curved terraces with seeded, irregular arcs. Positions are deterministic per candle id; sectors of 96 holders grow in half-rings south of the home row, with no cap. It uses viewport culling and three LODs: cached low-resolution sector art with cached per-sector light layers, sprites, and sprites with animated flames. Empty stone holders mark unsold places. Zoom, pan, pinch, keyboard, minimap, find by id, My candles rings and a paged candle register keep every candle reachable.

## Licenses

- Source code: MIT.
- Art in `web/public/art/`, `web/public/favicon.svg` and `web/public/og.png`: original work for this site, CC0 1.0. The scenery is procedurally painted by `web/art-src/paint.js`, and the provenance is in `artifacts/asset-manifest.md` (copied to `web/public/art/LICENSE.md`). `og.png` is a screenshot of the export.
- Wallet marks in `web/src/components/walletIcons.ts`: the vendors' marks, as shipped by RainbowKit 2.2.11 (MIT), used only to identify each wallet.
- Fonts: none bundled. The site uses system serif and sans stacks.
- npm dependencies keep their own licenses (React, wagmi, viem, TanStack Query: MIT).

## Validation

These are worker-side results from 2026-11-17. The full record is in `artifacts/validation.md`, and the screenshots are in `artifacts/screens/`.

| Check | Result |
| --- | --- |
| `npm run typecheck` (`tsc --noEmit`) | exit 0 |
| `npx vitest run` | 2 files, 32/32 passed (purchase/claim flow on labelled mocks, paging, layout continuity, closed-form sector index past 4,096 sectors, escaping) |
| `npx vite build` | built into `dist/` |
| design-critic probe `taste.mjs` | 16/16 checks passed at 320/390/1440 |
| Headless Chromium on the export (live reads + `?fixture=0/100/3000/10000`) | routes, Find, click hit test, anchored popup, Escape, mobile menu and split sheet checked; frame times measured |

**Limitations.** The scenery is procedural, not illustrated: no image-generation tool was available. It follows the reference's composition and palette but does **not** reach the requested 99% visual similarity, and no similarity score was measured (compare `artifacts/screens/side-by-side-1600.webp`). No wallet transaction ran in a browser. Hosting is done by the publishing plane from the committed `dist/`.
