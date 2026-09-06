/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const GEMINI_AUTH_TOKENS_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens'

const TOKEN_EXPIRE_MS = 30 * 60 * 1000
const NEW_SESSION_EXPIRE_MS = 60 * 1000

/** Thrown when minting a Gemini Live ephemeral token fails, either because the
 *  API rejected the request or because the response could not be parsed. */
export class GeminiEphemeralTokenError extends Error {}

export type MintGeminiEphemeralTokenParams = {
  apiKey: string
  model: string
  /** Injectable for tests; defaults to global fetch (native fetch on desktop). */
  fetchImpl?: typeof fetch
  /** Injectable clock (ms since epoch) for deterministic expiry; defaults to Date.now. */
  now?: () => number
}

/** Mint a short-lived Gemini Live ephemeral token from a BYOK key. Returns the
 *  token name (`token.name`) to use as `access_token` on the direct Live WS. */
export const mintGeminiEphemeralToken = async (params: MintGeminiEphemeralTokenParams): Promise<string> => {
  const { apiKey, model, fetchImpl = fetch, now = Date.now } = params

  const nowMs = now()
  const expireTime = new Date(nowMs + TOKEN_EXPIRE_MS).toISOString()
  const newSessionExpireTime = new Date(nowMs + NEW_SESSION_EXPIRE_MS).toISOString()

  const response = await fetchImpl(GEMINI_AUTH_TOKENS_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model,
        config: { responseModalities: ['AUDIO'], sessionResumption: {} },
      },
    }),
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new GeminiEphemeralTokenError(
      `Failed to mint Gemini ephemeral token: ${response.status} ${response.statusText}${bodyText ? ` - ${bodyText}` : ''}`,
    )
  }

  const bodyText = await response.text()

  let data: { name?: unknown }
  try {
    data = JSON.parse(bodyText) as { name?: unknown }
  } catch {
    throw new GeminiEphemeralTokenError(`Gemini ephemeral token: malformed JSON response (${response.status})`)
  }

  if (typeof data.name !== 'string') {
    throw new GeminiEphemeralTokenError('Gemini ephemeral token response is missing a valid "name" field')
  }

  return data.name
}
