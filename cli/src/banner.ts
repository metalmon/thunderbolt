/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Standalone REPL banner shared by plain and TUI modes.
 */

import { cliVersion } from './cli.ts'
import { i18n } from './fork/i18n.ts'
import { commandName } from './fork/identity.ts'
import { amber, bold, brandGradient, dim, spark } from './ui/theme.ts'

/** ⚠ A function: module scope resolves at import time, before the stored
 *  language preference has been read out of `config.json`. */
export const bannerHint = (): string => i18n._({ id: 'type a task, or / for commands' })

/**
 * Builds the two-line REPL header (title + version, then a one-line hint) as a
 * string. Color is applied only on an interactive TTY. Returned rather than
 * written so the TUI can wrap it in a component instead of touching stdout,
 * which would corrupt the differential renderer.
 */
export const bannerText = (width: number = process.stdout.columns ?? 80): string => {
  // Fork: the wordmark is FLAT, the hairline keeps the gradient.
  //
  // `brandGradient` interpolates per character, so its smoothness depends on how
  // many characters it has to spend. Upstream's eleven-letter name moved ~7 RGB
  // units per letter; `volt` has four and moves ~23 — not a sweep but four
  // visibly different colours in a row, which reads as broken precisely because
  // the 28-character hairline underneath does sweep smoothly.
  //
  // Amber rather than raspberry: it is the gradient's START, so the hairline
  // below reads as continuing the word rather than departing from it.
  const hairlineLength = Math.min(28, Math.max(8, Math.floor(width / 5)))
  return `${bold(spark())} ${bold(amber(commandName))} ${dim(`v${cliVersion}`)}\n${brandGradient(
    '─'.repeat(hairlineLength),
  )}\n${dim(bannerHint())}`
}

/**
 * Prints the REPL header to stdout for the plain (non-TUI) interactive loop.
 * No-op-safe in non-TTY environments (the text still prints, just without
 * color).
 */
export const printBanner = (): void => {
  process.stdout.write(`${bannerText()}\n\n`)
}
