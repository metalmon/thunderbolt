/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { parseContentParts } from '@/ai/widget-parser'
import { setActiveVoiceSpeaker } from '@/voice/active-speaker'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { executeSay } from './executor'
import { parse } from './schema'

describe('say widget extraction', () => {
  it('pulls the say tag out of surrounding assistant text, with its text', () => {
    const result = parseContentParts('Одну секунду. <widget:say text="Готово." /> Что дальше?')

    expect(result).toEqual([
      { type: 'text', content: 'Одну секунду.' },
      { type: 'widget', widget: { widget: 'say', args: { text: 'Готово.' } } },
      { type: 'text', content: 'Что дальше?' },
    ])
  })

  it('ignores a say tag with empty text (invalid, removed from output)', () => {
    const result = parseContentParts('Before <widget:say text="" /> After')

    expect(result).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'text', content: 'After' },
    ])
  })
})

describe('say schema parse', () => {
  it('parses a valid text attribute', () => {
    expect(parse({ text: 'Hello' })).toEqual({ widget: 'say', args: { text: 'Hello' } })
  })

  it('rejects a missing text attribute', () => {
    expect(parse({})).toBeNull()
  })
})

describe('executeSay', () => {
  afterEach(() => {
    // Never leak a registered speaker into other test files sharing this process.
    setActiveVoiceSpeaker(null)
  })

  it('speaks the text via the active engine when passed explicitly in ctx', () => {
    const sendText = mock((_text: string) => {})

    executeSay({ text: 'Готово.' }, { voice: { sendText } })

    expect(sendText).toHaveBeenCalledWith('Готово.')
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('is a silent no-op when ctx carries no voice session', () => {
    expect(() => executeSay({ text: 'Готово.' }, { voice: null })).not.toThrow()
  })

  it('is a silent no-op when ctx is omitted and nothing is registered', () => {
    setActiveVoiceSpeaker(null)

    expect(() => executeSay({ text: 'Готово.' })).not.toThrow()
  })

  it('falls back to the process-wide active-speaker registry when ctx is omitted', () => {
    const sendText = mock((_text: string) => {})
    setActiveVoiceSpeaker({ sendText })

    executeSay({ text: 'Готово.' })

    expect(sendText).toHaveBeenCalledWith('Готово.')
  })
})
