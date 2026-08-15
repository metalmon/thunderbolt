/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { buildAgentSubprotocols, buildAgentWebSocketFactory } from './subprotocols'

describe('buildAgentSubprotocols', () => {
  it('returns carrier + bearer entry for a token', () => {
    expect(buildAgentSubprotocols('zc_abc123')).toEqual(['zeroclaw.acp.v1', 'bearer.zc_abc123'])
  })

  it('returns undefined for null / undefined / empty', () => {
    expect(buildAgentSubprotocols(null)).toBeUndefined()
    expect(buildAgentSubprotocols(undefined)).toBeUndefined()
    expect(buildAgentSubprotocols('')).toBeUndefined()
    expect(buildAgentSubprotocols('   ')).toBeUndefined()
  })

  it('sends the token verbatim (no encoding)', () => {
    const t = 'zc_0123456789abcdef'
    expect(buildAgentSubprotocols(t)).toEqual(['zeroclaw.acp.v1', `bearer.${t}`])
  })
})

describe('buildAgentWebSocketFactory', () => {
  /** Swap the global `WebSocket` for a capturing stub, run `fn`, then always
   *  restore — so the factory's `new WebSocket(url, protocols)` construction
   *  is observable without opening a real socket. */
  const withCapturedWebSocket = (fn: () => void): { url: string; protocols: unknown }[] => {
    const seen: { url: string; protocols: unknown }[] = []
    class CapturingWebSocket {
      constructor(url: string, protocols?: unknown) {
        seen.push({ url, protocols })
      }
    }
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
    Object.defineProperty(globalThis, 'WebSocket', { value: CapturingWebSocket, writable: true, configurable: true })
    try {
      fn()
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'WebSocket', originalDescriptor)
      }
    }
    return seen
  }

  it('returns a factory that opens with the carrier + bearer subprotocols for a token', () => {
    const factory = buildAgentWebSocketFactory('zc_abc123')
    expect(factory).toBeDefined()

    const seen = withCapturedWebSocket(() => {
      factory?.('wss://example.test/ws')
    })

    expect(seen).toEqual([{ url: 'wss://example.test/ws', protocols: ['zeroclaw.acp.v1', 'bearer.zc_abc123'] }])
  })

  it('returns undefined for null / undefined / empty — callers fall back to their own default', () => {
    expect(buildAgentWebSocketFactory(null)).toBeUndefined()
    expect(buildAgentWebSocketFactory(undefined)).toBeUndefined()
    expect(buildAgentWebSocketFactory('')).toBeUndefined()
    expect(buildAgentWebSocketFactory('   ')).toBeUndefined()
  })
})
