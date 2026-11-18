# Everlight Garden: asset manifest and provenance

This file is `artifacts/asset-manifest.md`; the same text ships with the site as `web/public/art/LICENSE.md`.

**Tooling disclosure.** This job ran on a machine with **no image-generation model or tool** and no licensed artwork library. I made no AI-generated images and downloaded no third-party artwork. Every raster asset below is **original procedural artwork**. It is painted in code by `web/art-src/paint.js` (value noise, fBm textures, bezier foliage, gradient materials) and encoded to WebP by `web/art-src/generate.mjs`. The output is deterministic: the same script always produces the same images.

The approved reference image was used only as a visual target. No pixel, crop or text from it is in any site asset. It appears only in the comparison images under `artifacts/screens/side-by-side-*.webp`, labelled as the reference.

Licence: the procedural assets and their generator are original work made for this project. They are released under CC0 1.0, matching the earlier site art. The candle sprites `candle-0…6.svg` and `favicon.svg` come from the previous job (see its validation record). They are hand-written SVG under the same terms.

Rebuild the assets:

```bash
npm i --prefix /tmp/art @napi-rs/canvas          # Skia canvas, prebuilt, not a site dependency
CANVAS_MODULE=/tmp/art/node_modules/@napi-rs/canvas/index.js node web/art-src/generate.mjs
```

| File (`web/public/art/`) | Bytes | Layer / role | Generator | Licence |
| --- | --- | --- | --- | --- |
| `bridge.webp` | 22,244 | Sector feature: Three-arched stone bridge; one per sector where the path crosses the stream, rotated to the path slope | `bridge()` in `web/art-src/paint.js` | CC0 1.0 |
| `bush-plain.webp` | 12,364 | Sector feature: Shrub without flowers | `bush(240, 150, 18, 0)` in `web/art-src/paint.js` | CC0 1.0 |
| `bush.webp` | 18,494 | Sector feature: Shrub with white flowers | `bush()` in `web/art-src/paint.js` | CC0 1.0 |
| `candle-0.svg` | 706 | Purchased candle sprite (drawn per frame from contract data only) | hand-written SVG from the previous job | CC0 1.0 |
| `candle-1.svg` | 695 | Purchased candle sprite (drawn per frame from contract data only) | hand-written SVG from the previous job | CC0 1.0 |
| `candle-2.svg` | 701 | Purchased candle sprite (drawn per frame from contract data only) | hand-written SVG from the previous job | CC0 1.0 |
| `candle-3.svg` | 606 | Purchased candle sprite (drawn per frame from contract data only) | hand-written SVG from the previous job | CC0 1.0 |
| `candle-4.svg` | 723 | Purchased candle sprite (drawn per frame from contract data only) | hand-written SVG from the previous job | CC0 1.0 |
| `candle-5.svg` | 812 | Purchased candle sprite (drawn per frame from contract data only) | hand-written SVG from the previous job | CC0 1.0 |
| `candle-6.svg` | 727 | Purchased candle sprite (drawn per frame from contract data only) | hand-written SVG from the previous job | CC0 1.0 |
| `frog.webp` | 17,006 | Sector feature (statue): cast-brass frog modelled as rounded volumes (radial-gradient brass lit by candlelight from the left, moonlit rim on the right), haunch and folded hind leg, lidded bulging eyes, webbed toes, cast warts, verdigris in the hollows, on a weathered mossy rock | `frog()` in `web/art-src/paint.js` | CC0 1.0 |
| `gazebo.webp` | 22,380 | Sector feature: Domed rotunda with a warm interior; seeded position per sector, small ones on the far hill bands | `gazebo()` in `web/art-src/paint.js` | CC0 1.0 |
| `ground.webp` | 4,954 | Ground (world-aligned pattern, filled by the renderer under every sector): Seamless lawn texture; one pattern in world space, so neighbouring sectors share it without a seam | `groundTile()` in `web/art-src/paint.js` | CC0 1.0 |
| `lantern.webp` | 2,878 | Decorative light: Brass lantern at each bridge head: steady and boxed, kept distinct from purchased candle flames | `lantern()` in `web/art-src/paint.js` | CC0 1.0 |
| `pedestal.webp` | 4,828 | Candle holder (every slot, inside the sector cache): Weathered stone pedestal with an empty cup, gold bands and moss. Slot 0 (candle #1) uses it at 2.1x as the founding pedestal in the near left of the opening view | `pedestal()` in `web/art-src/paint.js` | CC0 1.0 |
| `stone.webp` | 6,868 | Material pattern: Coursed stone: terrace walls, stream bed, flagstone walks, pool rims | `stoneTile()` in `web/art-src/paint.js` | CC0 1.0 |
| `tree-0.webp` | 12,134 | Sector feature: Broadleaf tree | `tree(…, 0)` in `web/art-src/paint.js` | CC0 1.0 |
| `tree-1.webp` | 13,920 | Sector feature: Broadleaf tree, second variant | `tree(…, 0)` in `web/art-src/paint.js` | CC0 1.0 |
| `tree-2.webp` | 13,672 | Sector feature: Cypress | `tree(…, 1)` in `web/art-src/paint.js` | CC0 1.0 |
| `waterfall.webp` | 11,988 | Sector feature: Falling water with mist; one rock sill and fall per sector at a seeded place on the stream | `waterfall()` in `web/art-src/paint.js` | CC0 1.0 |

Other shipped assets: `web/public/favicon.svg` (hand-written SVG, CC0 1.0) and `web/public/og.png` (a screenshot of the export, CC0 1.0).

Runtime layers (see `DESIGN.md`, "Garden scene"):

1. Vista: `makeVista()` in `web/src/garden/vista.ts`, procedural, drawn at runtime; the only parallax layer, seated on the world skyline.
2. Ground: `ground.webp` as one world-aligned pattern under every sector (`drawGround()` in `web/src/garden/renderer.ts`); open garden edges fade into the night.
3. Scenery per sector: `drawSectorArt()` in `web/src/garden/scenery.ts`, drawn in world coordinates onto a canvas with a 180-unit margin, cached. The stream and path are world-space curves (`streamX`, `pathY` in `layout.ts`), so neighbours draw them identically and they join without a seam.
4. Holders: pedestals at the exact slot positions, inside the same cache.
5. Purchased candles: per frame, from contract data only.
6. Lighting: an additive glow and a ground pool per candle.
7. HTML foreground frames and UI.

Nothing in any layer is copied from the reference image, and no candle is pre-lit in any asset.


## Changes in job 463ed97b follow-up (one-world repair)

- Removed from the site: `backdrop.webp` (a complete painted garden drawn in screen space behind the world, which caused the picture-in-picture effect) and the screen-fixed foreground frames `canopy.webp`, `frame-left.webp`, `frame-right.webp`. Their generators remain in `web/art-src/paint.js` but are no longer exported to `web/public/art/`.
- Added: the procedural distant vista in `web/src/garden/vista.ts` (sky, moon, clouds, three ridges, castle, far terraces). Original code, CC0 1.0, no third-party or reference pixels.
- **Art blocker (unresolved):** the brief asks for illustrated landscape layers and transparent assets made with image-generation or illustration tools. None was available to this worker: no image-generation tool or illustration agent was offered in this environment. Every asset here is therefore procedural (canvas-painted). It is **not** claimed to match the approved reference; see `artifacts/screens/side-by-side-*.jpg` for an honest comparison. To close this, the requester must supply illustrated layers or run the job with an image-generation tool; the renderer accepts replacements of the same names (sprites in `web/public/art/`, the vista via `makeVista()`).
