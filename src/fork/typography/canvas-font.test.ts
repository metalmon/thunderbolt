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

describe('buildCanvasScrollbarCss', () => {
  const css = buildCanvasScrollbarCss()

  it('themes the scrollbar off the injected color tokens (tracks light/dark)', () => {
    expect(css).toContain('scrollbar-color:var(--color-border) transparent')
    expect(css).toContain('::-webkit-scrollbar-thumb')
    expect(css).toContain('var(--color-border)')
    expect(css).toContain('var(--color-muted-foreground)')
  })

  it('does not use !important, so an artifact can override its own scrollbar', () => {
    expect(css).not.toContain('!important')
  })
})

describe('buildCanvasThemeExtrasCss', () => {
  it('is the font-face rules followed by the scrollbar rules', () => {
    expect(buildCanvasThemeExtrasCss()).toBe(buildCanvasFontFaceCss() + buildCanvasScrollbarCss())
  })
})
