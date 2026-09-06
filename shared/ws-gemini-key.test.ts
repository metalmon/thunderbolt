/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { test, expect } from 'bun:test'
import { encodeWsGeminiKey, decodeWsGeminiKey, wsGeminiKeySubprotocolPrefix } from './ws-gemini-key'

test('gemini-key subprotocol round-trips and is prefixed', () => {
  const enc = encodeWsGeminiKey('AIzaSExample-key')
  expect(enc.startsWith(wsGeminiKeySubprotocolPrefix)).toBe(true)
  expect(decodeWsGeminiKey(enc)).toBe('AIzaSExample-key')
})

test('decode rejects a non-gemini-key token', () => {
  expect(decodeWsGeminiKey('thunderbolt.bearer.whatever')).toBeNull()
})
