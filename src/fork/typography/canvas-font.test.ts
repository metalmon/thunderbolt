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

/** A theme snapshot the way `buildThemeStyleTag` hands one over. */
const tokens = { '--color-border': '#404040', '--color-muted-foreground': '#a19a91' }

describe('buildCanvasScrollbarCss', () => {
  const css = buildCanvasScrollbarCss(tokens)

  it('paints the thumb from the snapshot, so it tracks light/dark', () => {
    expect(css).toContain('::-webkit-scrollbar-thumb')
    expect(css).toContain('#404040')
    expect(css).toContain('#a19a91')
  })

  // The pilot's bright white bar in a dark panel: Chromium does not inherit custom
  // properties into the scrollbar pseudo-elements, so `background:var(--color-border)`
  // was invalid there and the browser painted its own thumb. Proved in the live frame —
  // the same rule with a literal colour took effect at once.
  it('never reaches for a custom property, which does not resolve in these pseudo-elements', () => {
    expect(css).not.toContain('var(')
  })

  it('still paints something when the snapshot carries no such token', () => {
    const bare = buildCanvasScrollbarCss({})
    expect(bare).toContain('::-webkit-scrollbar-thumb')
    expect(bare).not.toContain('var(')
    expect(bare).toContain('rgba(')
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
  it('is the font-face rules followed by the scrollbar rules', () => {
    expect(buildCanvasThemeExtrasCss(tokens)).toBe(buildCanvasFontFaceCss() + buildCanvasScrollbarCss(tokens))
  })
})
