/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt). Do not upstream. */

import { msg } from '@lingui/core/macro'
import type { I18n } from '@lingui/core'

/**
 * Fork: display-only, localizable descriptions for the built-in managed tools.
 *
 * The tool `description` shipped in `src/integrations/**` is model-facing — it
 * carries the behaviour-critical citation contract (`[Source N]`, `Cite with
 * [N]`, exact tool names) and MUST stay English so the model keeps citing
 * correctly. But that same string is also rendered verbatim in the "Available
 * tools" UI, where an English blob is wrong for a RU-first build.
 *
 * This map provides a clean, user-facing description keyed on the tool `name`.
 * The integrations UI mapper prefers it; the model path (getAvailableTools →
 * createToolset, which reads the tool `configs` directly) is never touched.
 * Descriptors are declared at module scope and resolved at the render site with
 * `i18n._(...)`, per the project's module-scope-freezes-the-locale rule.
 *
 * Returns `undefined` for any tool without a display override, so the UI falls
 * back to the raw model-facing description.
 */
const displayDescriptions: Record<string, ReturnType<typeof msg>> = {
  search: msg`Searches the web and returns results with their sources.`,
  fetch_content: msg`Opens a public web page and extracts its readable text, with the source.`,
}

/** Resolve a localized display description for a built-in tool, or `undefined`. */
export const forkToolDisplayDescription = (name: string, i18n: I18n): string | undefined => {
  const descriptor = displayDescriptions[name]
  return descriptor ? i18n._(descriptor) : undefined
}
