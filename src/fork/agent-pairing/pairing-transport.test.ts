/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@/testing-library'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { buildPairingSubprotocols } from '@/fork/agent-bearer/subprotocols'
import { resolvePairingWebSocketFactory } from './pairing-transport'

/** Minimal capturing WebSocket — records the `(url, protocols)` construction so
 *  we can assert what the pairing factory dials without opening a real socket. */
class FakeSocket {
  static instances: FakeSocket[] = []
  static reset(): void {
    FakeSocket.instances = []
  }
  url: string
  protocols: string[]
  constructor(url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = typeof protocols === 'string' ? [protocols] : (protocols ?? [])
    FakeSocket.instances.push(this)
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}

const originalWebSocket = globalThis.WebSocket

describe('resolvePairingWebSocketFactory', () => {
  beforeEach(() => {
    FakeSocket.reset()
    Object.defineProperty(globalThis, 'WebSocket', { value: FakeSocket, writable: true, configurable: true })
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'WebSocket', { value: originalWebSocket, writable: true, configurable: true })
  })

  it('standalone: native WS with the tokenless pairing subprotocols (no bearer)', () => {
    const factory = resolvePairingWebSocketFactory({ isStandalone: () => true, readProxyEnabled: () => null })
    factory('wss://gw.example/acp')

    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0].protocols).toEqual(buildPairingSubprotocols())
    expect(FakeSocket.instances[0].protocols.some((p) => p.startsWith('bearer.'))).toBe(false)
  })

  it('proxied: forwards the pairing carriers through the proxy, still no agent bearer', () => {
    const factory = resolvePairingWebSocketFactory({
      isStandalone: () => false,
      readProxyEnabled: () => null,
      getAuthToken: () => 'proxy-tok',
    })
    factory('wss://agent.example.com/acp')

    expect(FakeSocket.instances).toHaveLength(1)
    const { protocols } = FakeSocket.instances[0]
    expect(protocols).toContain('volt.acp.v1')
    expect(protocols).toContain('zeroclaw.acp.v1')
    // The proxy adds its own `thunderbolt.bearer.<token>`, but never a bare
    // `bearer.<agent-token>` — pairing is pre-auth/tokenless.
    expect(protocols.some((p) => p.startsWith('bearer.'))).toBe(false)
  })
})
