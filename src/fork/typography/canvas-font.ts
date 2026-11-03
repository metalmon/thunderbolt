/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

/**
 * Artifact-iframe theming extras: the bundled chat reading font + a theme-matched
 * scrollbar, appended to the theme `<style>` injected into every rendered artifact
 * (see `src/artifacts/theme-tokens.ts` `buildThemeStyleTag`).
 *
 * The artifact iframe is sandboxed with a strict offline CSP (`font-src data:
 * blob:`, never `allow-same-origin` — see `src/artifacts/harness.ts`), so it cannot
 * reach the app's `@font-face` rules or bundled font URLs. Without help, the reading
 * font `var(--font-chat)` (Plantin Cyr MT primary) AND the Cyrillic fallback of
 * `var(--font-heading)` fall through to Georgia / a system serif inside the frame.
 * Embedding the four Plantin faces as `data:` URIs in an injected `@font-face` (the
 * four weights total ~67 KB) makes both resolve to the real face — matching the
 * chat prose. The interface/sans font is a system stack, so it needs no embedding.
 */

import { plantinBold, plantinBoldItalic, plantinItalic, plantinRegular } from './plantin-data-uris'

const face = (dataUri: string, weight: 400 | 700, style: 'normal' | 'italic'): string =>
  `@font-face{font-family:'Plantin Cyr MT';src:url(${dataUri}) format('woff2');font-weight:${weight};font-style:${style};font-display:swap;}`

/**
 * The four Plantin Cyr MT `@font-face` rules with the font data inlined as `data:`
 * URIs. Always emitted: `--font-heading` carries Plantin as its Cyrillic fallback
 * regardless of the user's chat-font setting, so Cyrillic headings need it even when
 * chat prose is set to the system sans.
 */
export const buildCanvasFontFaceCss = (): string =>
  face(plantinRegular, 400, 'normal') +
  face(plantinBold, 700, 'normal') +
  face(plantinItalic, 400, 'italic') +
  face(plantinBoldItalic, 700, 'italic')

/** Used when the theme snapshot carries no such token: readable on either theme, and
 *  deliberately translucent so it never reads as a solid bar on an unknown background. */
const neutralThumb = 'rgba(128,128,128,0.45)'
const neutralThumbHover = 'rgba(128,128,128,0.7)'

/**
 * A thin theme-matched scrollbar for the artifact iframe. The app hides scrollbars
 * globally (`src/index.css`), but an isolated artifact does not inherit that and a
 * bare default scrollbar clashes with the theme. Colours reference the host theme
 * tokens already forced onto `:root`, so it tracks light/dark; no `!important`, so
 * an artifact that styles its own scrollbar still wins.
 *
 * ⚠ ONE mechanism only, and that is the whole point of this note. This used to set
 * `scrollbar-width`/`scrollbar-color` on `*` as well — and in Chromium, which is what
 * WebView2 runs, naming either of those makes the `::-webkit-scrollbar` pseudo-elements
 * below be ignored ENTIRELY. Every rule here was dead: the frame drew the platform
 * default sized by `thin`, which is why a pilot panel showed a system scrollbar inside
 * an otherwise themed page. Measured in the live frame — `scrollbarWidth` computed to
 * `thin` there while the app's own document computes `none`.
 *
 * So: do not add `scrollbar-width` or `scrollbar-color` back here without deleting
 * these. Picking the pseudo-elements is deliberate — they are what draws the rounded
 * thumb and the hover colour; the standard properties can express neither.
 */
export const buildCanvasScrollbarCss = (tokens: Record<string, string> = {}): string => {
  // ⚠ Literal colours, never `var()`. Chromium does not inherit custom properties into
  // the scrollbar pseudo-elements, so `background:var(--color-border)` is invalid at
  // computed-value time there and the browser falls back to its own thumb — a bright
  // white bar inside a dark panel, reported from the pilot. Proved in the live frame:
  // the same rule with a literal colour painted immediately.
  //
  // The values come from the theme snapshot this tag is already built from, so the
  // scrollbar still tracks light/dark — it is resolved here instead of in the frame.
  const thumb = tokens['--color-border'] || neutralThumb
  const thumbHover = tokens['--color-muted-foreground'] || neutralThumbHover
  return (
    `*::-webkit-scrollbar{width:10px;height:10px;}` +
    `*::-webkit-scrollbar-track{background:transparent;}` +
    `*::-webkit-scrollbar-thumb{background:${thumb};background-clip:padding-box;border:2px solid transparent;border-radius:9999px;}` +
    `*::-webkit-scrollbar-thumb:hover{background:${thumbHover};background-clip:padding-box;}` +
    `*::-webkit-scrollbar-corner{background:transparent;}`
  )
}

/**
 * All fork CSS appended inside the injected artifact theme `<style>`, after the
 * `:root { … }` token block: the embedded reading-font `@font-face` rules plus the
 * theme-matched scrollbar. Pure — string-only, no DOM — so it stays inside the
 * verification-neutral, CSS-only theme-style contract.
 *
 * Takes the same theme snapshot the token block is built from, because the scrollbar
 * rules resolve their colours here rather than through `var()` — see above.
 */
export const buildCanvasThemeExtrasCss = (tokens: Record<string, string> = {}): string =>
  buildCanvasFontFaceCss() + buildCanvasScrollbarCss(tokens)
