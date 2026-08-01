/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Active realtime voice speaker registry — the bridge between the `say`
 * widget and whichever realtime voice session is currently live.
 *
 * The `say` widget's executor (`src/widgets/say/executor.ts`) runs wherever
 * assistant text is processed, which is not necessarily voice code, so it
 * can't hold a direct reference to a `RealtimeEngine`. Instead, the realtime
 * session (`src/voice/realtime-session.ts`) registers its `sendText` here
 * when it starts and clears it when it stops; the executor reads this
 * registry as its default speak target. Mirrors the process-wide singleton
 * pattern already used by `voice-mode.ts` for the same reason (tab-global
 * signal, no DI container in this codebase).
 */
export type VoiceSpeaker = { sendText: (text: string) => void }

let activeSpeaker: VoiceSpeaker | null = null

/** Called by the realtime session on start (with the live engine) and on stop (with `null`). */
export const setActiveVoiceSpeaker = (speaker: VoiceSpeaker | null): void => {
  activeSpeaker = speaker
}

/** The currently active realtime voice session's speak hook, or `null` when none is active. */
export const getActiveVoiceSpeaker = (): VoiceSpeaker | null => activeSpeaker
