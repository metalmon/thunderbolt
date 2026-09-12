/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import { composeCanvasCallId, parseCanvasToolCallId, CANVAS_TOOLCALL_PREFIX } from './canvas-call-id'

describe('canvas-call-id', () => {
  it('composes <nonce>:<appId>', () => {
    expect(composeCanvasCallId('n1', '7')).toBe('n1:7')
  })
  it('parses canvas:<nonce>:<appId> positionally', () => {
    const cid = composeCanvasCallId('n1', '7')
    expect(parseCanvasToolCallId(`${CANVAS_TOOLCALL_PREFIX}${cid}`)).toEqual({ nonce: 'n1', appCallId: '7' })
  })
  it('treats the ENTIRE remainder after the nonce as opaque app-id (colon-stuffed, cannot forge the nonce)', () => {
    const toolCallId = `${CANVAS_TOOLCALL_PREFIX}n1:foo:canvas:otherNonce:1`
    expect(parseCanvasToolCallId(toolCallId)).toEqual({ nonce: 'n1', appCallId: 'foo:canvas:otherNonce:1' })
  })
  it('rejects a non-canvas toolCallId', () => {
    expect(parseCanvasToolCallId('tool_abc')).toBeNull()
    expect(parseCanvasToolCallId('canvas:')).toBeNull() // no nonce segment
    expect(parseCanvasToolCallId('canvas:n1')).toBeNull() // no app-id segment
  })
})
