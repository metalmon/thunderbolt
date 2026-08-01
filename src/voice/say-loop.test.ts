/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setActiveVoiceSpeaker } from '@/voice/active-speaker'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { speakSayWidgets } from './say-loop'

describe('speakSayWidgets', () => {
  afterEach(() => {
    // Never leak a registered speaker into other test files sharing this process.
    setActiveVoiceSpeaker(null)
  })

  it('speaks a say tag embedded in an assistant reply through the active session', () => {
    const sendText = mock((_text: string) => {})
    setActiveVoiceSpeaker({ sendText })

    speakSayWidgets('Одну секунду. <widget:say text="Готово." /> Что дальше?')

    expect(sendText).toHaveBeenCalledWith('Готово.')
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('speaks every say tag in a reply that carries more than one', () => {
    const sendText = mock((_text: string) => {})
    setActiveVoiceSpeaker({ sendText })

    speakSayWidgets('<widget:say text="First." /> and <widget:say text="Second." />')

    expect(sendText.mock.calls.map((call) => call[0])).toEqual(['First.', 'Second.'])
  })

  it('does not speak when the reply carries no say tag', () => {
    const sendText = mock((_text: string) => {})
    setActiveVoiceSpeaker({ sendText })

    speakSayWidgets('A plain reply with no widgets at all.')

    expect(sendText).not.toHaveBeenCalled()
  })

  it('is a no-op when no realtime voice session is active', () => {
    setActiveVoiceSpeaker(null)

    expect(() => speakSayWidgets('Hi <widget:say text="Готово." /> there')).not.toThrow()
  })
})
