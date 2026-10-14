/* Fork (metalmon): the appearance a guest surface has to match.
 *
 * Volt ships a third theme, "paper" — a fixed warm appearance that is neither
 * light nor dark (`.paper` in `src/index.css`). Upstream's `useResolvedTheme`
 * answers `'light' | 'dark'` and resolves anything else through the OS media
 * query, which is right for `'system'` and wrong for `'paper'`: a paper user on
 * a dark OS was reported as `dark`, so an embedded Mini App rendered a dark
 * panel inside a warm sand client. The defect is invisible in code review and
 * obvious on a screen.
 *
 * The canvas path never had this bug because it reads the class off `<html>`
 * (`sandboxed-html-frame.tsx`, `canvas-action-channel.tsx`), which it can do
 * because it runs at frame-init time rather than in render. A hook cannot read
 * the DOM and stay reactive without an observer, so this composes the two pieces
 * upstream already exposes instead: the *setting* (which carries `paper`) and
 * the resolved light/dark (which carries the OS flip for `system`).
 */

import { useResolvedTheme, useTheme, type Theme } from '@/lib/theme-provider'

/** What a guest surface renders as. Mirrors the classes `applyResolvedTheme` sets. */
export type ResolvedAppearance = 'light' | 'dark' | 'paper'

/**
 * Pick the appearance from the stored setting and the resolved light/dark pair.
 *
 * Kept separate from the hook so it can be tested without a provider, and
 * because the rule is the whole point: `paper` is its own appearance and must
 * not be collapsed into either neighbour. Everything else defers to the resolved
 * value, which is what makes `system` follow the OS.
 */
export const resolveAppearance = (setting: Theme, lightOrDark: 'light' | 'dark'): ResolvedAppearance =>
  setting === 'paper' ? 'paper' : lightOrDark

/** The live appearance, re-rendering on a setting change and on an OS theme flip. */
export const useResolvedAppearance = (): ResolvedAppearance => resolveAppearance(useTheme().theme, useResolvedTheme())
