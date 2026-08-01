/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { geminiVoices } from '@/voice/engine/gemini-live-engine'
import { defaultVoiceProvider, useLocalSettingsStore } from '@/stores/local-settings-store'
import VoiceSettingsPage from './voice'

// Radix Select relies on pointer-capture / scroll APIs that happy-dom doesn't
// implement. Stub them so the trigger can open in this test environment —
// scoped to this file since no other suite renders `@/components/ui/select`.
beforeEach(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

const setGeminiLiveProvider = (patch: Partial<typeof defaultVoiceProvider> = {}) => {
  useLocalSettingsStore.getState().setLocalSetting('voiceProvider', {
    ...defaultVoiceProvider,
    kind: 'gemini-live',
    ...patch,
  })
}

/** Opens a `Select` by its accessible label and returns the option labels
 *  currently rendered in its (portalled) listbox. */
const openSelectOptions = (label: string): string[] => {
  fireEvent.pointerDown(screen.getByLabelText(label), { button: 0, ctrlKey: false, pointerType: 'mouse' })
  const listbox = screen.getByRole('listbox')
  return within(listbox)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '')
}

describe('VoiceSettingsPage — Gemini Live model/voice/personality (Task 10)', () => {
  beforeEach(() => {
    useLocalSettingsStore.persist.clearStorage()
    setGeminiLiveProvider()
  })

  afterEach(() => {
    cleanup()
    useLocalSettingsStore.persist.clearStorage()
    useLocalSettingsStore.setState({ voiceProvider: defaultVoiceProvider })
  })

  it('renders the model select, voice select, and personality textarea bound to the store', () => {
    render(<VoiceSettingsPage />)

    expect(screen.getByLabelText('Model')).toBeInTheDocument()
    expect(screen.getByLabelText('Voice')).toBeInTheDocument()
    const textarea = screen.getByLabelText('Personality prompt')
    expect(textarea).toBeInTheDocument()
    expect(textarea).toHaveValue('')
  })

  it('voice select options equal geminiVoices[model] for the current (default) model', () => {
    render(<VoiceSettingsPage />)

    const options = openSelectOptions('Voice')
    expect(options).toEqual(geminiVoices['half-cascade'])
  })

  it('swaps the voice select options when the model changes', () => {
    setGeminiLiveProvider({ model: 'native-audio', voiceName: 'Puck' })
    render(<VoiceSettingsPage />)

    const options = openSelectOptions('Voice')
    expect(options).toEqual(geminiVoices['native-audio'])
    expect(options).not.toEqual(geminiVoices['half-cascade'])
  })

  it('typing in the personality textarea updates the store', () => {
    render(<VoiceSettingsPage />)

    fireEvent.change(screen.getByLabelText('Personality prompt'), {
      target: { value: 'Be concise and warm.' },
    })

    expect(useLocalSettingsStore.getState().voiceProvider.personalityPrompt).toBe('Be concise and warm.')
  })
})
