/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getActiveVoiceSpeaker, type VoiceSpeaker } from '@/voice/active-speaker'

export type SayArgs = { text: string }

export type SayContext = {
  /** The active realtime voice session's speak hook, or `null`/absent when no
   *  realtime voice session is active. Defaults to the process-wide registry
   *  the voice session maintains (`@/voice/active-speaker`), so a caller that
   *  merely parsed a `say` tag out of assistant text — with no direct handle
   *  on the voice session — can still reach it by omitting `ctx` entirely. */
  voice?: VoiceSpeaker | null
}

/**
 * Executes the `say` widget: speaks `text` aloud via the active realtime
 * voice engine. A silent no-op (never throws) when no realtime voice session
 * is active — e.g. a `say` tag reaching a plain text chat.
 */
export const executeSay = ({ text }: SayArgs, ctx: SayContext = { voice: getActiveVoiceSpeaker() }): void => {
  ctx.voice?.sendText(text)
}
