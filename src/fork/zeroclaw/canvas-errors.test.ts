/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* src/fork/zeroclaw/canvas-errors.test.ts */
import { describe, expect, it } from 'bun:test'
import { CANVAS_JSONRPC_ERRORS, classifyCanvasRequest } from './canvas-errors'

describe('CANVAS_JSONRPC_ERRORS', () => {
  it('preserves the pre-existing JSON-RPC codes', () => {
    expect(CANVAS_JSONRPC_ERRORS.TOOL_FAILED.code).toBe(-32000)
    expect(CANVAS_JSONRPC_ERRORS.NO_CANVAS.code).toBe(-32001)
    expect(CANVAS_JSONRPC_ERRORS.READ_ONLY.code).toBe(-32003)
    expect(CANVAS_JSONRPC_ERRORS.RATE_LIMITED.code).toBe(-32005)
    expect(CANVAS_JSONRPC_ERRORS.INVALID_PARAMS.code).toBe(-32602)
  })
})

describe('classifyCanvasRequest', () => {
  const base = { hasCanvas: true, isReadOnly: false, rateAllowed: true, hasToolName: true }

  it('proceeds only when every gate passes', () => {
    expect(classifyCanvasRequest(base)).toEqual({ kind: 'proceed' })
  })

  it('rejects with NO_CANVAS when there is no active canvas, regardless of the other gates', () => {
    expect(classifyCanvasRequest({ ...base, hasCanvas: false })).toEqual({
      kind: 'reject',
      error: CANVAS_JSONRPC_ERRORS.NO_CANVAS,
    })
    // NO_CANVAS wins even when every other gate would also fail.
    expect(
      classifyCanvasRequest({ hasCanvas: false, isReadOnly: true, rateAllowed: false, hasToolName: false }),
    ).toEqual({ kind: 'reject', error: CANVAS_JSONRPC_ERRORS.NO_CANVAS })
  })

  it('rejects with READ_ONLY when the canvas is a read-only snapshot, ahead of rate-limit/param checks', () => {
    expect(classifyCanvasRequest({ ...base, isReadOnly: true })).toEqual({
      kind: 'reject',
      error: CANVAS_JSONRPC_ERRORS.READ_ONLY,
    })
    expect(classifyCanvasRequest({ ...base, isReadOnly: true, rateAllowed: false, hasToolName: false })).toEqual({
      kind: 'reject',
      error: CANVAS_JSONRPC_ERRORS.READ_ONLY,
    })
  })

  it('rejects with RATE_LIMITED only once hasCanvas and !isReadOnly hold, ahead of the param check', () => {
    expect(classifyCanvasRequest({ ...base, rateAllowed: false })).toEqual({
      kind: 'reject',
      error: CANVAS_JSONRPC_ERRORS.RATE_LIMITED,
    })
    expect(classifyCanvasRequest({ ...base, rateAllowed: false, hasToolName: false })).toEqual({
      kind: 'reject',
      error: CANVAS_JSONRPC_ERRORS.RATE_LIMITED,
    })
  })

  it('rejects with INVALID_PARAMS only when every earlier gate has passed', () => {
    expect(classifyCanvasRequest({ ...base, hasToolName: false })).toEqual({
      kind: 'reject',
      error: CANVAS_JSONRPC_ERRORS.INVALID_PARAMS,
    })
  })

  it('proceeds for a ui/prompt-shaped input (hasToolName always true, no rate limit applied)', () => {
    expect(classifyCanvasRequest({ hasCanvas: true, isReadOnly: false, rateAllowed: true, hasToolName: true })).toEqual(
      { kind: 'proceed' },
    )
    expect(classifyCanvasRequest({ hasCanvas: true, isReadOnly: true, rateAllowed: true, hasToolName: true })).toEqual({
      kind: 'reject',
      error: CANVAS_JSONRPC_ERRORS.READ_ONLY,
    })
  })
})
