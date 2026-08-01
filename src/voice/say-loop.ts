/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `say`-tag detection loop (Task 12).
 *
 * When the chat agent settles an assistant reply during an active realtime
 * voice session, its text may carry one or more `<widget:say text="..."/>`
 * tags (advertised by the `say` skill — Task 8/9). The generic widget extractor
 * already strips those tags from the *rendered* chat text, but nothing speaks
 * them: the `say` widget component renders `null` and has no side effect.
 *
 * This helper closes that gap. It reuses the existing `parseContentParts`
 * widget extraction (no bespoke tag parsing) over the settled assistant text,
 * pulls out every `say` widget, and hands each to `executeSay`, which routes
 * the text to the live engine's `sendText` via the active-speaker registry.
 *
 * It is a fast no-op when no realtime voice session is active (the common
 * case) — the parse is skipped entirely — so it is safe to call on the finish
 * of every chat reply.
 */
import { parseContentParts } from '@/ai/widget-parser'
import { getActiveVoiceSpeaker } from '@/voice/active-speaker'
import { executeSay } from '@/widgets/say'

/** Scan a settled assistant message for `<widget:say>` tags and speak each one
 *  through the active realtime voice session. No-op when no session is live. */
export const speakSayWidgets = (assistantText: string): void => {
  if (!getActiveVoiceSpeaker()) {
    return
  }
  for (const part of parseContentParts(assistantText)) {
    if (part.type === 'widget' && part.widget.widget === 'say') {
      executeSay(part.widget.args)
    }
  }
}
