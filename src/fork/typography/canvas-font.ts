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

/**
 * A thin theme-matched scrollbar for the artifact iframe. The app hides scrollbars
 * globally (`src/index.css`), but an isolated artifact does not inherit that and a
 * bare default scrollbar clashes with the theme. Colours reference the host theme
 * tokens already forced onto `:root`, so it tracks light/dark; no `!important`, so
 * an artifact that styles its own scrollbar still wins.
 */
export const buildCanvasScrollbarCss = (): string =>
  `*{scrollbar-color:var(--color-border) transparent;scrollbar-width:thin;}` +
  `*::-webkit-scrollbar{width:10px;height:10px;}` +
  `*::-webkit-scrollbar-track{background:transparent;}` +
  `*::-webkit-scrollbar-thumb{background:var(--color-border);background-clip:padding-box;border:2px solid transparent;border-radius:9999px;}` +
  `*::-webkit-scrollbar-thumb:hover{background:var(--color-muted-foreground);background-clip:padding-box;}` +
  `*::-webkit-scrollbar-corner{background:transparent;}`

/**
 * All fork CSS appended inside the injected artifact theme `<style>`, after the
 * `:root { … }` token block: the embedded reading-font `@font-face` rules plus the
 * theme-matched scrollbar. Pure — string-only, no DOM — so it stays inside the
 * verification-neutral, CSS-only theme-style contract.
 */
export const buildCanvasThemeExtrasCss = (): string => buildCanvasFontFaceCss() + buildCanvasScrollbarCss()
