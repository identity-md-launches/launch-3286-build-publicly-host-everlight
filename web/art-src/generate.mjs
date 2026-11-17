/*
 * Renders every procedural asset in paint.js and writes WebP files to web/public/art/.
 * Backend: @napi-rs/canvas (Skia, prebuilt, no system libraries). It is not a site dependency;
 * install it anywhere and point CANVAS_MODULE at it:
 *   npm i --prefix /tmp/art @napi-rs/canvas
 *   CANVAS_MODULE=/tmp/art/node_modules/@napi-rs/canvas/index.js node web/art-src/generate.mjs [name ...]
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../public/art");
const require = createRequire(import.meta.url);
const { createCanvas } = require(process.env.CANVAS_MODULE ?? "@napi-rs/canvas");

globalThis.window = globalThis;
globalThis.document = { createElement: () => createCanvas(1, 1) };
new Function(await readFile(join(here, "paint.js"), "utf8"))();
const art = globalThis.EVERLIGHT_ART;
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(art);
for (const name of names) {
  const t = Date.now();
  const c = art[name]();
  const buf = await c.encode("webp", name === "backdrop" ? 84 : 88);
  await writeFile(join(out, `${name}.webp`), buf);
  console.log(`${name}.webp ${c.width}x${c.height} ${(buf.length / 1024).toFixed(0)} KB ${Date.now() - t} ms`);
}
