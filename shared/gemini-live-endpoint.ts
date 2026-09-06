/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type GeminiLiveApiVersion = 'v1alpha' | 'v1beta'

/** Gemini Live selects a different upstream API version per model family:
 *  native-audio speaks v1alpha, everything else v1beta. Shared so the backend
 *  relay and the frontend direct-connect engine can never drift. */
export const geminiLiveApiVersion = (model: string): GeminiLiveApiVersion =>
  /native-audio/.test(model) ? 'v1alpha' : 'v1beta'

/** Build the Gemini Live BidiGenerateContent WebSocket URL for `model`.
 *  `authQuery` is the caller's already-encoded auth param — `key=<serverKey>`
 *  for the relay upstream, or `access_token=<ephemeralToken>` for the direct client. */
export const geminiLiveWsUrl = (model: string, authQuery: string): string => {
  const svc = `google.ai.generativelanguage.${geminiLiveApiVersion(model)}.GenerativeService.BidiGenerateContent`
  return `wss://generativelanguage.googleapis.com/ws/${svc}?${authQuery}`
}
