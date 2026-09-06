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

  it('commits a typed Gemini API key to the store only on Save (write-only, like agents)', () => {
    render(<VoiceSettingsPage />)

    const field = screen.getByLabelText('Gemini API key')
    fireEvent.change(field, { target: { value: 'AIza-my-key' } })
    // Write-only: typing does not commit; the store updates on explicit Save.
    expect(useLocalSettingsStore.getState().voiceProvider.geminiApiKey).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(useLocalSettingsStore.getState().voiceProvider.geminiApiKey).toBe('AIza-my-key')
    // After save the draft clears, so the field is empty again with the saved indicator.
    expect(field).toHaveValue('')
  })

  it('masks a saved key (write-only, "Key saved" placeholder) and offers to remove it', () => {
    setGeminiLiveProvider({ geminiApiKey: 'AIza-saved-secret' })
    render(<VoiceSettingsPage />)

    const field = screen.getByLabelText('Gemini API key')
    // The stored key is never rendered into the field; the placeholder signals one exists.
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', 'Key saved')
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument()
  })

  it('removes the saved Gemini API key', () => {
    setGeminiLiveProvider({ geminiApiKey: 'AIza-saved-secret' })
    render(<VoiceSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))

    expect(useLocalSettingsStore.getState().voiceProvider.geminiApiKey).toBe('')
  })

  it('shows an enabled Test connection button once a key is typed (hidden when empty)', () => {
    render(<VoiceSettingsPage />)

    // No key + empty draft → the action row (Test/Save/Remove) isn't rendered.
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'AIza-k' } })
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled()
  })
})
