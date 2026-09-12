/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* src/fork/zeroclaw/canvas-pending.test.ts */
import { describe, expect, it } from 'bun:test'
import { composeCanvasCallId, CANVAS_TOOLCALL_PREFIX } from './canvas-call-id'
import { createNonceRateLimiter, findResolvedPending, type PendingCall } from './canvas-pending'

const msg = (parts: unknown[]) => ({ id: 'm', role: 'assistant', parts }) as never

const toolPart = (toolCallId: string, state: 'output-available' | 'output-error', extra: Record<string, unknown>) => ({
  type: 'tool-canvas',
  toolCallId,
  state,
  ...extra,
})

describe('createNonceRateLimiter', () => {
  it('allows `limit` calls in a window then blocks', () => {
    const limiter = createNonceRateLimiter(2, 1000)
    expect(limiter.allow('n1', 0)).toBe(true)
    expect(limiter.allow('n1', 10)).toBe(true)
    expect(limiter.allow('n1', 20)).toBe(false)
  })

  it('refills after windowMs', () => {
    const limiter = createNonceRateLimiter(1, 1000)
    expect(limiter.allow('n1', 0)).toBe(true)
    expect(limiter.allow('n1', 500)).toBe(false)
    expect(limiter.allow('n1', 1000)).toBe(true)
  })

  it('tracks buckets independently per nonce', () => {
    const limiter = createNonceRateLimiter(1, 1000)
    expect(limiter.allow('n1', 0)).toBe(true)
    expect(limiter.allow('n2', 0)).toBe(true)
    expect(limiter.allow('n1', 0)).toBe(false)
  })
})

describe('findResolvedPending', () => {
  const nonce = 'nonce-1'
  const callId = composeCanvasCallId(nonce, 'app-1')
  const pending: PendingCall = { callId, nonce, jsonRpcId: 7 }

  it('matches a completed tool part by parsed (nonce, appCallId)', () => {
    const messages = [
      msg([toolPart(`${CANVAS_TOOLCALL_PREFIX}${callId}`, 'output-available', { output: { ok: true } })]),
    ]
    const resolved = findResolvedPending(messages as never, [pending])
    expect(resolved).toEqual([{ pending, output: { ok: true }, failed: false }])
  })

  it('reports failed for an output-error part', () => {
    const messages = [msg([toolPart(`${CANVAS_TOOLCALL_PREFIX}${callId}`, 'output-error', { errorText: 'boom' })])]
    const resolved = findResolvedPending(messages as never, [pending])
    expect(resolved).toEqual([{ pending, output: 'boom', failed: true }])
  })

  it('ignores a part whose parsed nonce differs (stale/cross-frame)', () => {
    const otherNonceCallId = composeCanvasCallId('other-nonce', 'app-1')
    const messages = [
      msg([toolPart(`${CANVAS_TOOLCALL_PREFIX}${otherNonceCallId}`, 'output-available', { output: { ok: true } })]),
    ]
    const resolved = findResolvedPending(messages as never, [pending])
    expect(resolved).toEqual([])
  })

  it('ignores a non-canvas or still-pending tool part', () => {
    const messages = [
      msg([
        toolPart(`${CANVAS_TOOLCALL_PREFIX}${callId}`, 'output-available', { output: {} }),
        { type: 'tool-other', toolCallId: 'plain-id', state: 'output-available', output: {} },
      ]),
    ]
    // Only asserting the non-canvas part doesn't crash the scan / produce a spurious match for a different pending.
    const otherPending: PendingCall = { callId: composeCanvasCallId(nonce, 'app-2'), nonce, jsonRpcId: 8 }
    const resolved = findResolvedPending(messages as never, [otherPending])
    expect(resolved).toEqual([])
  })
})
