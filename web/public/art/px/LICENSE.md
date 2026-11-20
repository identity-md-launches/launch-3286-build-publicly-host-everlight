# Everlight Garden pixel assets: provenance and permissions

All files in this folder are original pixel art made for Everlight Garden on 2026-11-19 by the site's build
worker. They are not traced or cut from the approved reference screenshot, or from any other game or artwork.
Each PNG is written pixel by pixel by `web/art-src/pixel/build.mjs` from one shared 16-bit palette (listed in
`manifest.json`). Rebuild with `cd web && node art-src/pixel/build.mjs`.

License: CC0 1.0 Universal (public domain dedication). Anyone may use, modify and redistribute them.

| Group | Files |
| --- | --- |
| Tiles, 16x16, seamless | tile-grass, tile-grass-dark, tile-path, tile-wall, tile-moss-stone, tile-water-0..2 |
| Holders | holder (empty, unlit cup), pedestal-hero (the founding candle #1) |
| Candle sprites, 10x16, style IDs 0-6 | candle-0 Moon taper, candle-1 Ember pillar, candle-2 Lantern bloom, candle-3 Lily float, candle-4 Gilded spiral, candle-5 Frog lamp, candle-6 Star votive |
| Flame frames, 7x10 | flame-0..3 (warm gold, cycled for lit candles only), glow (stepped halo) |
| Props | lamp (decorative, green glass: never a purchased candle), arch, willow, tree, cypress, bush, bush-flower, flowers, lilypad, lilypad-flower, vine, rock |
| Characters | frog-reader, frog-wanderer, frog-gardener, frog-sitter (original round-eyed garden frogs) |
| Revision 10 (2026-11-20, same generator, same CC0 terms) | garland (flower swag with pink/lavender/white blossoms and a hung green-glass lantern, laid over `arch`), willow-s and willow-l (two more willow sizes for clusters), reeds (bank reeds and cattails), bank-stones; frog vignettes frog-fisher (fishing from a bank stone), frog-lily (on a flowering lily pad), frog-sweeper (sweeping petals) |

The distant vista (sky, moon, ridges, castle) is painted in code at start-up by `web/src/garden/vista.ts`,
under the same CC0 terms.
