/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Raised when voice has no engine it can actually reach.
 *
 * ⚠ The case this exists for: `createVoiceEngine` ends in an unconditional
 * fallback to the hosted engine, which is `/v1/audio/*` on OUR backend. On an
 * autonomous install that lane does not exist, so the fallback handed back an
 * engine whose every request was going to fail — voice looked configured and
 * then simply did not work.
 *
 * Saying so is the honest answer, and it is a different answer from "the
 * microphone is blocked" or "Gemini is unreachable": nothing is broken, the
 * user has just not named an endpoint yet. The display boundary turns this into
 * that sentence; see `use-voice-session.ts`.
 */
export class VoiceEngineUnavailableError extends Error {
  constructor() {
    super('no voice engine is reachable: local mode and no OpenAI-compatible endpoint configured')
    this.name = 'VoiceEngineUnavailableError'
  }
}

/**
 * Whether a caught value is {@link VoiceEngineUnavailableError}.
 *
 * By name rather than `instanceof`: the error crosses a dynamic import boundary
 * in the voice session, and a second module instance would make `instanceof`
 * quietly false — the kind of failure that shows up as the wrong message.
 *
 * @param error - the caught value
 */
export const isVoiceEngineUnavailable = (error: unknown): boolean =>
  error instanceof Error && error.name === 'VoiceEngineUnavailableError'
