/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Wire contract for WebSocket Gemini API key authentication carrier subprotocol.
 *
 * Similar to the bearer token carrier (`ws-bearer.ts`), we base64url-encode
 * Gemini API keys for transport over WebSocket subprotocol (since keys contain
 * characters invalid in RFC 6455 subprotocol tokens). The prefix, carrier, and
 * codec live in one place to prevent silent drift between client and server.
 */

import { encodeWsBearer, decodeWsBearer } from './ws-bearer'

/** Gemini-key subprotocol entries start with this prefix; the rest is the base64url-encoded key. */
export const wsGeminiKeySubprotocolPrefix = 'thunderbolt.gemini-key.'

/**
 * Encode a raw Gemini API key to an RFC 6455 subprotocol-safe string.
 * Returns the full subprotocol entry: prefix + base64url-encoded key.
 * @param key The raw Gemini API key.
 * @returns The full subprotocol entry with prefix and encoded key.
 */
export const encodeWsGeminiKey = (key: string): string => {
  return wsGeminiKeySubprotocolPrefix + encodeWsBearer(key)
}

/**
 * Decode a gemini-key subprotocol entry back to the raw API key.
 * Returns null if the entry does not start with the gemini-key prefix,
 * or if decoding the payload fails.
 * @param encoded The full subprotocol entry (prefix + base64url-encoded key).
 * @returns The raw API key, or null if the entry is not a valid gemini-key entry.
 */
export const decodeWsGeminiKey = (encoded: string): string | null => {
  if (!encoded.startsWith(wsGeminiKeySubprotocolPrefix)) {
    return null
  }
  const payload = encoded.slice(wsGeminiKeySubprotocolPrefix.length)
  return decodeWsBearer(payload)
}
