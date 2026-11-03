/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). See ./canvas-font.ts. */

import { describe, expect, it } from 'bun:test'
import { buildCanvasFontFaceCss, buildCanvasScrollbarCss, buildCanvasThemeExtrasCss } from './canvas-font'

describe('buildCanvasFontFaceCss', () => {
  const css = buildCanvasFontFaceCss()

  it('emits four Plantin Cyr MT @font-face rules', () => {
    expect(css.match(/@font-face/g)).toHaveLength(4)
    expect(css.match(/font-family:'Plantin Cyr MT'/g)).toHaveLength(4)
  })

  it('embeds the fonts as woff2 data: URIs (no external URL the sandbox cannot reach)', () => {
    expect(css.match(/url\(data:font\/woff2;base64,/g)).toHaveLength(4)
    expect(css).toContain("format('woff2')")
    expect(css).not.toContain('.woff2)') // no bare file/URL reference
  })

  it('covers regular, bold, italic and bold-italic', () => {
    expect(css).toContain('font-weight:400;font-style:normal')
    expect(css).toContain('font-weight:700;font-style:normal')
    expect(css).toContain('font-weight:400;font-style:italic')
    expect(css).toContain('font-weight:700;font-style:italic')
  })

  it('uses font-display:swap so a slow face never blanks the text', () => {
    expect(css.match(/font-display:swap/g)).toHaveLength(4)
  })
})

/** A theme snapshot the way `buildThemeStyleTag` hands one over (dark theme values). */
const tokens = {
  '--color-background': '#1b1e1f',
  '--color-foreground': '#fafafa',
  '--color-muted-foreground': '#9e9e9e',
}

describe('buildCanvasScrollbarCss', () => {
  const css = buildCanvasScrollbarCss(tokens, 'dark')

  it('inverts the pair from the snapshot: a light thumb in a dark groove', () => {
    expect(css).toContain('-thumb{background:#fafafa')
    expect(css).toContain('-track{background:#1b1e1f')
  })

  // `paper` resolves to `light`, and its `--color-foreground` is a near-black #2b2622 —
  // the full-contrast thumb that reads right on a dark panel draws a hard black stripe
  // down a warm page. Light palettes use their own muted grey instead.
  it('softens the thumb on light schemes, where foreground is a near-black', () => {
    const paper = buildCanvasScrollbarCss(
      { '--color-background': '#f0e9dd', '--color-foreground': '#2b2622', '--color-muted-foreground': '#857a68' },
      'light',
    )
    expect(paper).toContain('-thumb{background:#857a68')
    expect(paper).toContain('-track{background:#f0e9dd')
    expect(paper).not.toContain('#2b2622')
  })

  // The bright white strip reported from the pilot. A transparent track does not show
  // the page behind it — it shows the iframe canvas, white unless the artifact paints
  // its own root — so colouring only the thumb left the groove white in a dark panel.
  it('paints the track rather than leaving it transparent', () => {
    expect(css).not.toContain('transparent;}')
    expect(css).toContain('*::-webkit-scrollbar{width:10px;height:10px;background:#1b1e1f;}')
  })

  // Chromium does not inherit custom properties into the scrollbar pseudo-elements, so
  // `background:var(--color-border)` was invalid there and the browser painted its own
  // thumb. Proved in the live frame — the same rule with a literal colour took effect.
  it('never reaches for a custom property, which does not resolve in these pseudo-elements', () => {
    expect(css).not.toContain('var(')
  })

  it('still paints a thumb when the snapshot carries no such token', () => {
    const bare = buildCanvasScrollbarCss({})
    expect(bare).toContain('-thumb{background:rgba(')
    expect(bare).not.toContain('var(')
  })

  // The regression that cost a pilot round: naming either standard property makes
  // Chromium ignore every `::-webkit-scrollbar` rule here, so the frame fell back to
  // the platform scrollbar sized by `thin` — themed page, system scrollbar, and
  // nothing in the CSS looking wrong. One mechanism, and this is what holds it.
  it('names neither standard scrollbar property, which would silence the rules above', () => {
    expect(css).not.toContain('scrollbar-width')
    expect(css).not.toContain('scrollbar-color')
  })

  it('does not use !important, so an artifact can override its own scrollbar', () => {
    expect(css).not.toContain('!important')
  })
})

describe('buildCanvasThemeExtrasCss', () => {
  it('is the font-face rules followed by the scrollbar rules, on the same scheme', () => {
    expect(buildCanvasThemeExtrasCss(tokens, 'dark')).toBe(
      buildCanvasFontFaceCss() + buildCanvasScrollbarCss(tokens, 'dark'),
    )
  })
})
