/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { defaultVoiceProvider, getLocalSetting, useLocalSettingsStore } from './local-settings-store'

describe('local-settings-store — Gemini Live voiceProvider fields (Task 10)', () => {
  beforeEach(() => {
    useLocalSettingsStore.persist.clearStorage()
    useLocalSettingsStore.setState({ voiceProvider: defaultVoiceProvider })
  })

  afterEach(() => {
    useLocalSettingsStore.persist.clearStorage()
    useLocalSettingsStore.setState({ voiceProvider: defaultVoiceProvider })
  })

  it('defaults model to half-cascade, voiceName to Autonoe, personalityPrompt to empty', () => {
    expect(defaultVoiceProvider.model).toBe('half-cascade')
    expect(defaultVoiceProvider.voiceName).toBe('Autonoe')
    expect(defaultVoiceProvider.personalityPrompt).toBe('')
    expect(getLocalSetting('voiceProvider')).toEqual(defaultVoiceProvider)
  })

  it('accepts gemini-live as a voiceProvider kind', () => {
    useLocalSettingsStore.getState().setLocalSetting('voiceProvider', { ...defaultVoiceProvider, kind: 'gemini-live' })

    expect(useLocalSettingsStore.getState().voiceProvider.kind).toBe('gemini-live')
  })

  it('persists updated model/voiceName/personalityPrompt to localStorage', () => {
    useLocalSettingsStore.getState().setLocalSetting('voiceProvider', {
      ...defaultVoiceProvider,
      kind: 'gemini-live',
      model: 'native-audio',
      voiceName: 'Puck',
      personalityPrompt: 'Be concise and warm.',
    })

    const persisted = JSON.parse(localStorage.getItem('thunderbolt-local-settings') ?? '{}') as {
      state: { voiceProvider: typeof defaultVoiceProvider }
    }

    expect(persisted.state.voiceProvider.model).toBe('native-audio')
    expect(persisted.state.voiceProvider.voiceName).toBe('Puck')
    expect(persisted.state.voiceProvider.personalityPrompt).toBe('Be concise and warm.')
  })
})
