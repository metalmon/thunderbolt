/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* src/fork/zeroclaw/ui-resource-part.test.ts */
import { describe, expect, it } from 'bun:test'
import { isUiResourcePart, uiResourceOfPart } from './ui-resource-part'

const uiPart = {
  type: 'tool-canvas',
  toolCallId: 'tc-1',
  state: 'output-available',
  output: { uiResource: { uri: 'ui://pnl/dashboard', mimeType: 'text/html', html: '<h1/>' } },
}

describe('isUiResourcePart', () => {
  it('accepts a completed ui:// tool part', () => {
    expect(isUiResourcePart(uiPart)).toBe(true)
    expect(uiResourceOfPart(uiPart)?.uri).toBe('ui://pnl/dashboard')
  })
  it('rejects text parts, render_html output, and streaming ui parts', () => {
    expect(isUiResourcePart({ type: 'text', text: 'x' })).toBe(false)
    expect(
      isUiResourcePart({ type: 'tool-render_html', toolCallId: 'r', state: 'output-available', output: { ok: true } }),
    ).toBe(false)
    expect(isUiResourcePart({ ...uiPart, state: 'input-available' })).toBe(false)
  })
})
