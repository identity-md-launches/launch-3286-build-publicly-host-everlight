# Revision 10 validation: three review findings + garden art rebuild

Base: accepted revision 9 (4b16d13). Site: https://everlight.imd.site/ (the plane pins the committed `dist/`; this job ran no publish command and deployed nothing on chain).

## Findings and fixes

| Finding | Reproduced? | Fix | Source | Regression test |
|---|---|---|---|---|
| a103c521 (high): two tabs can both send a purchase | Yes. Both tabs passed the early check, and plain `persist()` let the second overwrite the first, so the wallet was asked twice. | The buy intent is saved with `pendingStore.persistExclusive(intent, buyConflict(account))`, which reads it back, under a Web Lock `everlight-buy-<account>`. `busy`/`conflict` returns `DUPLICATE_MESSAGE` before the wallet is asked. | web/src/lib/purchase.ts:384, web/src/panels/LightPanel.tsx:222 | web/tests/revision9.test.ts:130 (two tabs over one Map: the wallet is asked once, tab B is refused, tab A's draft is kept), plus the held-lock case |
| 658d1824 (medium): the purchase lock was shared by every account | Yes. All intents used the one `INTENT_HASH`, and the guard matched any account. | Intents are keyed `intentHash("buy", account)`. The guard and the panel use `buyConflict(account)` (same kind and same account). Release and settle call `removeBuyIntent(account)`, which removes only that account's key, and a legacy shared intent only if that account wrote it. | web/src/lib/purchase.ts:42-50, :344; web/src/panels/LightPanel.tsx:56, :128, :192, :413 | web/tests/revision9.test.ts:160 |
| 2b696629 (low): fixture notice shown twice | Yes, at 1600x1000. | The hero copy renders only when the docked panel is closed. The panel's `role=note` bar stays beside its disabled action. On mobile and with the panel collapsed, the hero note is the only label, so it stays. | web/src/App.tsx:321 | browser run: `fixtureNotes: 1` on every page at both widths (`artifacts/rev10/browser-results.json`) |
| 073292f9 (high): garden rebuild not done | Yes. The arches were bare, trees were single repeats, and the stream used a sheared tile (`X + (Y >> 2)`) that drew uniform diagonal stripes. | New original CC0 sprites from `web/art-src/pixel/build.mjs`: garland (flowered arch with a hung lantern), willow-s and willow-l, reeds, bank-stones, frog-fisher, frog-lily, frog-sweeper. In scenery: quiet water (depth gradient, dark bank reflections, sparse glints; the animated ripples are unchanged); reeds, stones and lily pads along both banks; an arched bridge deck with a voussoir ring, a shadowed opening and a mirrored reflection on the water; willow clusters of 2-4 trunks in three sizes; terrace earth banks behind the lawn and dithered contact shadows at the wall foot; four terrace arrangements (hedge, flower border, lantern walk, old ruin) picked per sector by `terraceArrangement(gx, gy)`; frog vignettes. Slot coordinates and candle IDs are unchanged (`layout.ts` was not edited). | web/src/garden/scenery.ts:74, :192, :241, :260, :286, :339, :344, :383; web/src/garden/renderer.ts:26 | stairs/layout tests still pass; screenshots below |

## Commands and results (this machine)

- `cd web && npm ci`: ok.
- `npx tsc --noEmit`: exit 0.
- `npx vitest run`: **13 files, 134 tests passed** (3 new; 2 older tests updated only for the per-account key name). Log: `artifacts/rev10/vitest.txt`.
- `npm run build` (tsc + vite, base `./`, outDir `../dist`): ok. `dist/index.html` uses relative `./assets/...` URLs.
- Browser walkthrough: Playwright 1.56 driving the cached Chromium headless shell 1248, with the missing system libraries unpacked from Ubuntu .debs into a temp folder (no root). The export was served in-process. Results: `artifacts/rev10/browser-results.json`. Screenshots: `artifacts/rev10/screens/` at 1600x1000 (`d-*`) and 390x844 (`m-*`).
  - Labelled fixtures `?fixture=0|100|3000|10000`: the headline reads 0 / 100 / 3,000 / 10,000 lit, with no horizontal overflow and one fixture note per screen.
  - Water: the canvas changed over 700 ms at every fixture, including 0 candles. With `prefers-reduced-motion: reduce` it did not change.
  - Find 37 opened the Candle #37 detail (`detail: true`) at both widths. Pan/zoom by keyboard (+ x3, ArrowRight x4): `*-fixture100-panzoom.jpg`.
  - Light, My Candles, Rewards, Treasury and How it works were captured at both widths with no page errors. Each page logged one `requestfailed` for the document URL itself (`/`), the same local-server artifact recorded in revision 9.
- Design probe `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`: **all 16 checks passed**. Record: `artifacts/rev10/taste-probe.json`. The 390 screenshot shows the headline, the one-line description, "Light a candle · 1 IMD" and the status line on the first screen.

### Live read-only vs mock

- Live read-only: not re-run this round (the probe and walkthrough load the export, whose RPC reads go out from the sandboxed browser). Revision 9 recorded `totalCandles() = 0` on 0x33a5…30a5.
- Mock only: every purchase, claim and approval test uses labelled in-memory storage, a mock wallet and mock chain reads. No fork, no wallet, no funds.

## Better Interface review (six domains, this round's changes)

- Accessibility: the fixture label is now one `role=note` beside the disabled action (App.tsx:321). The canvas art is decorative, and candle detail and Find are unchanged. Reduced motion freezes the water (measured).
- Layout: the hero no longer carries a second fixture bar, so the count line sits directly above the garden. No overflow at 320/390/1440 (probe) or at 390/1600 (walkthrough).
- Writing: no new copy except the purchase duplicate message, which now names the account-scoped cause in the code path (existing `DUPLICATE_MESSAGE` text kept).
- Typography: unchanged. The probe's type-sizes and type-faces checks pass.
- Colors: new blossoms use pink #d98aa8/#f2c4d2 and lavender #9a86c8/#c9bdf0 as small accents inside the emerald scene. Lanterns stay green glass, so only purchased candles carry amber.
- UI: the purchase and claim recovery controls are unchanged. Release now clears only the connected account's intent.

## Limitations

- The rebuild is a sprite and scenery pass on the existing renderer, not a fully hand-painted scene. Terraces still sit on the same procedural arcs (slot coordinates are fixed); the change is that they now have earth banks and contact shadows. The four arrangements vary decoration, not geometry.
- Contrast for text over the canvas was not measured by the probe (as in revision 9).
- No live wallet was connected; nothing was signed or sent.
