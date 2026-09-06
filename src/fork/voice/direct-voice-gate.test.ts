/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { isDirectVoiceKeyMissing } from './direct-voice-gate'

describe('isDirectVoiceKeyMissing', () => {
  it('is true when co-pilot is on, proxy is off, and the key is empty', () => {
    expect(isDirectVoiceKeyMissing({ coPilotEnabled: true, proxyEnabled: false, geminiApiKey: '' })).toBe(true)
  })

  it('is true when the key is whitespace-only', () => {
    expect(isDirectVoiceKeyMissing({ coPilotEnabled: true, proxyEnabled: false, geminiApiKey: '   ' })).toBe(true)
  })

  it('is false when a key is present', () => {
    expect(isDirectVoiceKeyMissing({ coPilotEnabled: true, proxyEnabled: false, geminiApiKey: 'abc123' })).toBe(false)
  })

  it('is false when the proxy is enabled (relay may hold the key server-side)', () => {
    expect(isDirectVoiceKeyMissing({ coPilotEnabled: true, proxyEnabled: true, geminiApiKey: '' })).toBe(false)
  })

  it('is false when co-pilot is disabled', () => {
    expect(isDirectVoiceKeyMissing({ coPilotEnabled: false, proxyEnabled: false, geminiApiKey: '' })).toBe(false)
  })
})
