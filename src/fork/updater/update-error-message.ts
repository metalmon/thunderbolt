/* Copyright (c) Okta Plus LLC. All rights reserved.
 * Fork-owned file (see AGENTS.md / CLAUDE.md: additive fork surface). */

/**
 * Fork: user-facing copy for updater failures.
 *
 * The updater's errors arrive as English strings from the Tauri plugin, and
 * `update-notification.tsx` rendered them verbatim — so a Russian build showed
 * «Не удалось обновить» over `Updater does not have any endpoints set.`
 *
 * That is the project's own rule applied, not bent: a thrown Error stays
 * English, and the DISPLAY boundary translates it. Code-mapped user copy is
 * display, not control flow — the same split `src/lib/otp-error-messages.ts`
 * makes.
 *
 * Matched on the message text rather than a code because the plugin offers no
 * codes. The patterns are deliberately loose: a miss costs nothing (the raw
 * string still shows, which is what happens today), while a false positive
 * would hide a real cause behind the wrong sentence — so each pattern names
 * something only one failure can say.
 *
 * Descriptors at module scope, resolved at the render site with `i18n._`, per
 * the module-scope-freezes-the-locale rule.
 */

import { msg } from '@lingui/core/macro'
import type { I18n, MessageDescriptor } from '@lingui/core'

const knownFailures: Array<{ match: RegExp; message: MessageDescriptor }> = [
  // The build carries no update channel at all — a perimeter build, or a dev run.
  // Not a failure the user can act on, so it says so rather than inviting a retry.
  { match: /does not have any endpoints set/i, message: msg`This build does not receive updates.` },
  // Everything that failed to reach the channel. One sentence for all of them:
  // the user's move is the same whichever layer refused.
  {
    match: /network|timed? out|timeout|dns|connection|connect|unreachable|refused|resolve/i,
    message: msg`Could not reach the update server.`,
  },
  // A downloaded update that failed verification. Worth its own sentence: nothing
  // was installed, and that is the part the user needs to know.
  {
    match: /signature|verif|corrupt|checksum/i,
    message: msg`The update failed its signature check and was not installed.`,
  },
]

/**
 * Localize an updater error for display.
 *
 * @param raw - the plugin's English message
 * @param i18n - the active i18n instance
 * @returns localized copy when the failure is one we recognise, otherwise `raw`
 *   unchanged — an untranslated cause is still better than a hidden one
 */
export const forkUpdateErrorMessage = (raw: string, i18n: I18n): string => {
  const known = knownFailures.find(({ match }) => match.test(raw))
  return known ? i18n._(known.message) : raw
}
