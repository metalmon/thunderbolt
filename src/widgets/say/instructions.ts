/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * AI instructions for the `say` widget. Reused verbatim by the `say` skill
 * (advertised only while a realtime voice session can be active — see
 * `src/defaults/skills.ts`), so its wording must stand alone without the
 * surrounding widget-catalog framing other instructions rely on.
 */
export const instructions = `## Say
<widget:say text="TEXT" />
Speaks TEXT aloud through the user's live voice session. Use this to relay your answer when replying to a request that arrived via voice — TEXT is heard, never shown as chat text, so keep it short, conversational, and free of markdown, links, code, and citations. Emit at most one \`say\` per reply, containing everything you want spoken, and don't also repeat those words as plain chat text.`
