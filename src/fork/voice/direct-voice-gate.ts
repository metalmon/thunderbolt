/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type DirectVoiceKeyParams = {
  /** `isVoiceCoPilotEnabled(experimentalFeatureVoice)` — the realtime Gemini
   *  Live co-pilot is turned on for this device. */
  coPilotEnabled: boolean
  /** `computeEffectiveProxyEnabled()` — when true, the connection relays
   *  through Volt's backend, which may hold its own server-side key. */
  proxyEnabled: boolean
  /** The device-local BYOK Gemini API key (`getLocalSetting('voiceProvider').geminiApiKey`). */
  geminiApiKey: string
}

/**
 * True when the user would take the DIRECT Gemini voice path (co-pilot on +
 * proxy off) but has supplied no BYOK key — so the session must be blocked
 * with a prompt to add one, rather than opening a doomed connection.
 */
export const isDirectVoiceKeyMissing = (params: DirectVoiceKeyParams): boolean =>
  params.coPilotEnabled && !params.proxyEnabled && params.geminiApiKey.trim().length === 0
