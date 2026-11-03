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

/**
 * Fork: display-only, localizable NAMES for the built-in tools.
 *
 * Same split as the descriptions above, one level up: the tool is called
 * `fetch_content` on the wire and must stay so — the model's contract names it —
 * but the step list showed the raw name title-cased ("Fetch Content") in the
 * middle of a Russian conversation, because `formatDisplayName`
 * (`src/lib/tool-metadata.ts`) only knows how to capitalise.
 *
 * Only the built-in names live here. Tools discovered at runtime — MCP servers,
 * Mini Apps — keep falling through to the English formatter: their names come
 * from someone else's catalogue and we have nothing to translate them from.
 */
const displayNames: Record<string, ReturnType<typeof msg>> = {
  search: msg`Web search`,
  fetch_content: msg`Read page`,
  render_html: msg`Render page`,
  skill: msg`Skill`,
  get_app_context: msg`Read app`,
}

/** Resolve a localized display name for a built-in tool, or `undefined`. */
export const forkToolDisplayName = (name: string, i18n: I18n): string | undefined => {
  const descriptor = displayNames[name]
  return descriptor ? i18n._(descriptor) : undefined
}
