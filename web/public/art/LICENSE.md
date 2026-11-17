# Everlight Garden: asset manifest and provenance

**Tooling disclosure.** This job ran on a machine with **no image-generation model or tool** and no licensed artwork library. I made no AI-generated images and downloaded no third-party artwork. Every raster asset below is **original procedural artwork**. It is painted in code by `web/art-src/paint.js` (value noise, fBm textures, bezier foliage, gradient materials) and encoded to WebP by `web/art-src/generate.mjs`. The output is deterministic: the same script always produces the same images.

The approved reference image was used only as a visual target. No pixel, crop or text from it is in any site asset. It appears only in the comparison images under `artifacts/screens/side-by-side-*.webp`, labelled as the reference.

Licence: the procedural assets and their generator are original work made for this project. They are released under CC0 1.0, matching the earlier site art. The candle sprites `candle-0…6.svg` and `favicon.svg` come from the previous job (see its validation record). They are hand-written SVG under the same terms.

Rebuild the assets:

```bash
npm i --prefix /tmp/art @napi-rs/canvas          # Skia canvas, prebuilt, not a site dependency
CANVAS_MODULE=/tmp/art/node_modules/@napi-rs/canvas/index.js node web/art-src/generate.mjs
```

| File (`web/public/art/`) | Size px | Layer / role | Painted by (`paint.js`) |
| --- | --- | --- | --- |
| `backdrop.webp` | 2400×1000 | Screen-space vista behind the world: night sky, stars, fBm clouds, moon with halo, two mountain ranges, castle hill with a lit castle, a small far temple, five misty bands of terraced hills with tree clusters, a moonlit river | `backdrop()`, `castle()` |
| `canopy.webp` | 2400×360 | Foreground overhanging leaves and vines (HTML layer, top edge) | `canopy()` |
| `frame-left.webp` | 760×1100 | Foreground frame: two carved columns and an arch with gold inlay, an ivy-covered emerald banner with a gold sprig, an armillary sphere on a pedestal, a brass frog on a mossy rock, dense leaves and white flowers | `frameLeft()` |
| `frame-right.webp` | 560×760 | Foreground frame: a rock ledge with a brass frog, foliage and white flowers | `frameRight()` |
| `pedestal.webp` | 160×200 | **Candle holder**: a weathered stone pedestal with an empty cup, gold bands and moss. It is drawn at every slot | `pedestal()` |
| `frog.webp` | 420×360 | Brass frog sculpture on a plinth (small guardians on the far banks) | `frog()` |
| `tree-0/1.webp`, `tree-2.webp` | 260–300×320–340, 120×340 | Broadleaf trees and a cypress | `tree()` |
| `bridge.webp` | 640×260 | Three-arched stone bridge with balusters and ivy | `bridge()` |
| `gazebo.webp` | 300×360 | Domed rotunda with a warm interior | `gazebo()` |
| `waterfall.webp` | 120×220 | Falling-water streaks with mist (one at each terrace drop) | `waterfall()` |
| `bush.webp`, `bush-plain.webp` | 260×170, 240×150 | Shrubs with and without white flowers | `bush()` |
| `lantern.webp` | 60×150 | Decorative brass lantern: a steady, boxed light, kept distinct from candle flames | `lantern()` |
| `ground.webp` | 512×512 | Seamless lawn texture (terrace fill pattern) | `groundTile()` |
| `stone.webp` | 256×256 | Coursed stone texture (retaining walls, stream bed) | `stoneTile()` |
| `candle-0…6.svg` | 40×80 | The seven equal-price candle styles (from the previous job) | — |

Runtime layers (see `DESIGN.md`):

1. Vista: `backdrop.webp` in screen space with slight parallax.
2. Scenery per sector: `web/src/garden/scenery.ts`, cached per sector.
3. Holders: pedestals at the exact slot positions, inside the same cache.
4. Purchased candles: per frame, from contract data only.
5. Lighting: an additive glow and a ground pool per candle.
6. Foreground frames: HTML `<img>`, pointer-events none.
7. HTML UI.

Removed: the previous primitive SVG scenery (`arch.svg`, `frog.svg`, `flowers.svg`, `holder.svg`).
