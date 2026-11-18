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

## Unresolved findings and limitations

1. **Art (blocker):** no image-generation or illustration tool was available, so no illustrated layers were produced. All scenery is procedural canvas art (now with a procedural vista). It does not match the reference's painterly richness: foliage reads as repeated sprites, there is no sculpted statue, armillary or banner in the world, and the far terraces are simple light points. See `artifacts/screens/side-by-side-*.jpg`. This needs illustrated assets from the requester or a rerun with an image tool.
2. At 10,000 candles the overview shows a regular rhythm: each grid column has one stream and each row one path, so the large-scale pattern looks gridded even though the edges are continuous.
3. Per-candle transaction hashes are not stored in the candle record. The popup links to the owner and to the owner's transactions to the garden, not to one exact transaction (except for purchases recovered from this browser's pending store).
4. Reflections are limited to the warm light pools; there is no mirrored flame in the water.
5. Hit testing uses a world-space radius; trees of nearer rows can cover a candle visually while it remains clickable.
6. No fork test or wallet transaction ran (see above). The frame-rate figures are headless lower bounds.
