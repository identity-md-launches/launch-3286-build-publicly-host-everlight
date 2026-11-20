# Revision 12 validation (job continuing 689d8862)

All results below were produced on this machine in this run. MOCKED = in-memory fixtures, mock wallets and mock RPC
clients. BROWSER = headless Chromium (Playwright 1.x, installed outside the repository) loading the committed `dist/`
from a local static server with `?fixture=N` (labelled fixture candles, payments disabled). No live chain or wallet
check was run in this session: no transactions, approvals or claims were sent and no contract or address changed.

## Commands
| Command | Result |
|---|---|
| `cd web && npm ci` | ok |
| `npm run typecheck` (`tsc --noEmit`) | 0 errors |
| `npm test` (vitest, MOCKED) | 15 files, 165 tests passed (149 earlier + 16 new in `web/tests/revision12.test.ts`) |
| `npm run build` | ok, `dist/` regenerated with relative asset URLs (`base: "./"`) |
| `node test/scratch/evidence.mjs dist …` (BROWSER) | results in `artifacts/rev12/browser-results.json`, shots in `artifacts/rev12/screens/` |
| `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | see below; raw output `artifacts/rev12/taste-probe.json` |

## Transaction findings → regression tests (MOCKED, `web/tests/revision12.test.ts`)
1. Unknown hash: wallet broadcasts at nonce 9 (preflight 7) then returns 4900 → `buy-unknown` "may have been sent"; an
   unrelated self-send at nonce 7 with nothing pending gives `not-found`, which no longer releases anything
   (`verifyCancelled`/`releaseVerified` stay locked, duplicate purchase refused); the matching call at nonce 9 resolves
   as `found`. Same for claims. Code: `web/src/lib/chain.ts` (verifyCancelled), `web/src/lib/intent.ts` (INTENT_NOT_FOUND), Release UI removed from `IntentRecovery`.
2. Durable attempt ids (`attemptOf`, `newAttemptId`, `pendingStore.removeAttempt/update/replace` in `web/src/lib/purchase.ts`):
   tab A's delayed receipt after tab B started a new uncertain purchase removes only A (B's intent with the same
   placeholder hash survives); stale rejections and hash-based removals never touch intents; `purchaseFlow.report`
   ignores a stale attempt's step; compare-and-update never resurrects a settled attempt.
3. Wallet binding: `walletStillBound` re-reads the connector's account and chain right before approve, buy and claim;
   an account switch during the async checks or a network switch after the approval sends nothing and withdraws the
   attempt's own intent. Requests pass `account` and `chainId: 1` explicitly.
4. Storage authority: memory holds only failed writes; an entry settled in another tab is not merged back; an overlay
   (sent hash that could not replace its saved intent) is dropped once storage no longer has the attempt; the
   memory fallback still blocks a duplicate send.
5. After Match, `IntentRecovery` passes the returned entry (real hash, verified nonce) to the check; a mined receipt
   settles in one `awaitBuy`; unknown outcomes say "may have been sent".
6. `latestAllowance` uses the newer read, never the max; a reduced allowance triggers an explicit fresh exact approval.

Earlier tests whose expectations encoded the old nonce-based release were updated to the new rule (revision 7, 9, 11 files).

## Browser: fixtures 0/100/3000/10000 (payments disabled)
| width | fixture | frame ms | fps (capped plan) | candles drawn | frogs in view | h-overflow |
|---|---|---|---|---|---|---|
| 1440 | 0 | 6.6 | 20 | 0 | 22 | False |
| 1440 | 100 | 7.0 | 30 | 96 | 22 | False |
| 1440 | 3000 | 7.3 | 28.9 | 168 | 22 | False |
| 1440 | 10000 | 7.9 | 28.2 | 168 | 22 | False |
| 390 | 0 | 2.6 | 20.4 | 0 | 14 | False |
| 390 | 100 | 3.0 | 19.9 | 63 | 14 | False |
| 390 | 3000 | 3.0 | 19.9 | 63 | 14 | False |
| 390 | 10000 | 3.0 | 19.9 | 63 | 14 | False |

Panels (light, mine, rewards, treasury, how) at 1440 and 390: no horizontal overflow; screenshots `d-*.jpg`, `m-*.jpg`.
Console/page errors: 0.

## Browser: frog activities (frame names sampled over ~1.6 s while following the actor)
| activity | animated | samples |
|---|---|---|
| read | True | read:0@-731,299 → read:0@-731,299 → read:1@-731,299 → read:1@-731,299 |
| ritual | False | ritual:1@822,336 → ritual:1@822,336 → ritual:1@822,336 → ritual:1@822,336 |
| dance | True | dance:0@-458,392 → dance:0@-458,392 → dance:1@-456,390 → dance:3@-454,392 |
| walk | True | walk:1@1434,479 → walk:0@1444,481 → walk:2@1453,483 → walk:1@1461,484 |
| roll | True | roll:1@840,541 → curl:0@837,541 → getup:0@837,541 → getup:0@837,541 |
| lantern | True | lantern:0@1800,564 → lantern:3@1809,566 → lantern:1@1818,568 → lantern:0@1826,570 |
| getup | True | getup:0@1436,986 → roll:1@1441,986 → roll:3@1447,986 → roll:1@1453,986 |
| curl | True | roll:3@881,541 → roll:1@874,541 → roll:3@868,541 → roll:1@862,541 |
| idle | True | curl:0@1436,986 → curl:0@1436,986 → getup:0@1436,986 → dance:0@1436,986 |
| lift | True | lantern:0@1716,544 → lantern:3@1707,542 → lantern:1@1698,540 → lantern:0@1690,538 |
| rest | True | rest:1@-326,2337 → rest:0@-326,2337 → rest:0@-326,2337 → rest:1@-326,2337 |

Reduced motion (`prefers-reduced-motion: reduce`): frames identical across samples = True, frames drawn while idle = 0.
Tap on a frog: route unchanged ('' → ''), no dialog, no wallet request (frogs are never hit-tested).
Walker and lantern samples over 5 s: `artifacts/rev12/walkers.json`.

## Taste probe
- render: pass
- layout: pass
- targets: pass
- contrast: pass
- casing: pass
- tracking: pass
- eyebrows: pass
- type-sizes: pass
- type-faces: pass
- glyphs: pass
- slogans: pass
- repetition: pass
- copy-budget: pass
- chrome: pass
- motion: pass
- share: pass

## Better Interface review (six domains, without-a-browser checks plus the rendered checks above)
- Accessibility: new Still-garden toggle is a real `<button>` with `aria-pressed`, an `aria-label` and title, disabled when the OS already asks for reduced motion (`web/src/garden/Garden.tsx`); frogs are decorative canvas pixels with no focus or hit area. Recovery copy uses `role="status"`.
- Layout: no new overflow at 390/1440 (measured); map tools gain one 44 px button in the existing column.
- Writing: uncertain outcomes say "may have been sent"; the removed Release path no longer promises a verified cancellation.
- Typography/colors: no new sizes or colors in CSS; the sprites use the existing manifest palette (emerald, ivory, amber; ritual lights mint so they never read as purchased amber candles).
- UI: search/recover controls replace the release flow; Check again settles a mined receipt at once.
- Limitations: contrast ratios were not re-measured (no colour changes); keyboard-only walkthrough not re-recorded this run.

## Disclosures and limitations
- The brief asked for "Pepe" characters. Pepe the Frog is a third-party copyrighted character, so the ambient actors are
  an original round emerald frog designed for this garden (domed eyes, cream belly, amber cheeks), drawn in code into one
  shared atlas (`web/src/garden/ambient.ts`). They do every requested activity.
- An attempt whose hash was never returned now stays locked until a matching transaction is found or its hash is
  pasted; there is deliberately no nonce-based release. A user who is sure nothing was sent can only clear it by clearing site data.
- Walkers rest beneath trees once the cell's trees are painted; frogs can pass in front of low props other than trees.
- Publication to https://everlight.imd.site/ is done by the hosting plane from the committed `dist/`; this run did not publish.
- Live RPC readiness checks were not repeated in this session; sales state shown is read live by the site at runtime.
