/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defaultVoiceProvider, type VoiceProviderConfig } from '@/stores/local-settings-store'
import { describe, expect, it } from 'bun:test'
import { geminiVoices } from './gemini-live-engine'
import { resolveGeminiEngineOptions } from './router'

const config = (overrides: Partial<VoiceProviderConfig>): VoiceProviderConfig => ({
  ...defaultVoiceProvider,
  kind: 'gemini-live',
  ...overrides,
})

describe('resolveGeminiEngineOptions', () => {
  it('maps half-cascade to the live-preview model id and passes voice + system instruction through', () => {
    const opts = resolveGeminiEngineOptions(config({ model: 'half-cascade', voiceName: 'Kore' }), 'SYSTEM PROMPT')

    expect(opts.model).toBe('gemini-live-2.5-flash-preview')
    expect(opts.voiceName).toBe('Kore')
    expect(opts.systemInstruction).toBe('SYSTEM PROMPT')
  })

  it('maps native-audio to the native-audio preview model id', () => {
    const opts = resolveGeminiEngineOptions(config({ model: 'native-audio', voiceName: 'Puck' }), 'SI')

    expect(opts.model).toBe('gemini-2.5-flash-native-audio-preview')
    expect(opts.voiceName).toBe('Puck')
  })

  it('advertises the submit_prompt tool', () => {
    const opts = resolveGeminiEngineOptions(config({ model: 'half-cascade' }), '')

    expect(opts.tools).toHaveLength(1)
    expect(opts.tools[0].name).toBe('submit_prompt')
  })

  it('falls back to the model family first voice when the stored voice is invalid for that model', () => {
    // `Autonoe` is a native-audio voice but NOT in the half-cascade catalog —
    // a stale value left over from switching models must not reach Gemini.
    const opts = resolveGeminiEngineOptions(config({ model: 'half-cascade', voiceName: 'Autonoe' }), '')

    expect(geminiVoices['half-cascade']).not.toContain('Autonoe')
    expect(opts.voiceName).toBe(geminiVoices['half-cascade'][0])
  })

  it('the default store voiceName is valid for the default model family', () => {
    expect(geminiVoices[defaultVoiceProvider.model]).toContain(defaultVoiceProvider.voiceName)
  })

  it("every model family's first voice is itself a real (non-empty) voice name", () => {
    for (const model of Object.keys(geminiVoices) as (keyof typeof geminiVoices)[]) {
      expect(geminiVoices[model][0]).toBeTruthy()
    }
  })
})
