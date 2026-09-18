const files: Record<string, string> = {
  plantinRegular: 'plantin-cyr.woff2',
  plantinBold: 'plantin-cyr-bold.woff2',
  plantinItalic: 'plantin-cyr-italic.woff2',
  plantinBoldItalic: 'plantin-cyr-bolditalic.woff2',
}
let out = `/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). GENERATED from ./fonts/plantin-cyr*.woff2 — do not edit
 * by hand. Regenerate: bun run dev-local/gen-plantin-data-uris.ts
 *
 * The chat reading font (Plantin Cyr MT) as base64 data: URIs, for embedding in an
 * @font-face injected into the sandboxed artifact iframe — which cannot reach the
 * app's @font-face or asset URLs (offline CSP: font-src data: blob:). Plain string
 * constants so the same import works under Vite and bun test (no ?inline). */

`
for (const [name, file] of Object.entries(files)) {
  const buf = await Bun.file(`src/fork/typography/fonts/${file}`).arrayBuffer()
  const b64 = Buffer.from(buf).toString('base64')
  out += `export const ${name} = 'data:font/woff2;base64,${b64}'\n`
}
await Bun.write('src/fork/typography/plantin-data-uris.ts', out)
console.log('wrote src/fork/typography/plantin-data-uris.ts', out.length, 'bytes')
