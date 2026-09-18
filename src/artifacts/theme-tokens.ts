/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Fork: reading-font @font-face (data: URIs) + theme-matched scrollbar for the
// sandboxed artifact iframe. See src/fork/typography/canvas-font.ts.
import { buildCanvasThemeExtrasCss } from '@/fork/typography/canvas-font'

/**
 * CSS custom properties defined on `:root` in `src/index.css` that an artifact is
 * expected to theme-match against. Agent-authored HTML reads these (with
 * fallbacks) and MUST NOT redefine `--color-*` itself — see spec §6.
 */
export const themeTokenNames = [
  '--color-background',
  '--color-foreground',
  '--color-card',
  '--color-card-foreground',
  '--color-popover',
  '--color-popover-foreground',
  '--color-muted',
  '--color-muted-foreground',
  '--color-border',
  '--color-input',
  '--color-ring',
  '--color-primary',
  '--color-primary-foreground',
  '--color-secondary',
  '--color-secondary-foreground',
  '--color-accent',
  '--color-accent-foreground',
  '--color-destructive',
  '--color-destructive-foreground',
  '--color-success',
  '--color-success-foreground',
  '--color-warning',
  '--color-warning-foreground',
  '--color-brand',
  '--color-brand-muted',
  '--color-brand-foreground',
  '--color-chart-1',
  '--color-chart-2',
  '--color-chart-3',
  '--color-chart-4',
  '--color-chart-5',
  '--radius',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--font-heading',
  // Fork: the chat reading font (Plantin Cyr MT stack) + its resolved size, so an
  // artifact matches chat prose. The real face is embedded via `buildCanvasThemeExtrasCss`
  // below — the sandboxed iframe can't load the app's @font-face otherwise.
  '--font-chat',
  '--font-chat-size',
  '--font-size-body',
  '--font-size-sm',
  '--font-size-xs',
] as const

export type ThemeTokenName = (typeof themeTokenNames)[number]

/** The CSS `color-scheme` values an artifact iframe can be told to render with. */
export type ArtifactColorScheme = 'light' | 'dark'

/**
 * Map the app's theme union to the `color-scheme` an artifact should render with.
 * `paper` is a fixed warm/light theme (see `theme-provider.tsx`), so it maps to
 * `light` alongside `light` itself. Callers must pass an already-resolved theme —
 * `'system'` is not a valid input here; resolve it first against whatever the
 * theme provider actually applied (see `snapshotThemeTokens`'s call site).
 */
export const resolveArtifactColorScheme = (resolvedTheme: 'light' | 'dark' | 'paper'): ArtifactColorScheme =>
  resolvedTheme === 'dark' ? 'dark' : 'light'

/**
 * Build the `<style>` tag injected as the FIRST style inside a wrapped artifact's
 * `<head>` (spec §6): forces the host's resolved theme tokens onto `:root` with
 * `!important` so an agent's own later `:root{}` block — equal specificity, later
 * in the cascade — cannot silently override them. Also sets `color-scheme` so
 * native form controls/scrollbars in the iframe match.
 *
 * Pure: takes already-resolved values, touches no DOM, and is unit-testable
 * without one. Only tokens with a non-empty value are emitted, so a caller that
 * couldn't resolve a given property (e.g. a token renamed upstream) degrades to
 * "not overridden" rather than injecting `--x: ;`.
 */
export const buildThemeStyleTag = (tokenValues: Record<string, string>, colorScheme: ArtifactColorScheme): string => {
  const declarations = themeTokenNames
    .map((name) => tokenValues[name])
    .map((value, index) => (value ? `${themeTokenNames[index]}: ${value} !important;` : null))
    .filter((declaration): declaration is string => declaration !== null)

  // Fork: after the :root token block, embed the reading-font @font-face (the
  // sandboxed iframe can't load the app's fonts) + a theme-matched scrollbar. Both
  // are CSS-only, keeping this tag verification-neutral (see harness.ts).
  return `<style>:root { ${declarations.join(' ')} color-scheme: ${colorScheme}; } ${buildCanvasThemeExtrasCss()}</style>`
}

/**
 * Snapshot the host app's currently resolved theme tokens off `document.documentElement`.
 * This is the one DOM-touching seam in this module — kept thin and separate from
 * `buildThemeStyleTag` so the string-building logic stays pure and testable.
 */
export const snapshotThemeTokens = (): Record<string, string> => {
  const styles = getComputedStyle(document.documentElement)
  const values: Record<string, string> = {}
  for (const name of themeTokenNames) {
    const value = styles.getPropertyValue(name).trim()
    if (value) {
      values[name] = value
    }
  }
  return values
}
