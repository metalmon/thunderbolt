/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { WebSocketLike } from '@/acp/transports/websocket'
import { getClock } from '@/testing-library'
import { pairOverAcp, PairingError } from './pair-over-acp'

type Listener = (event?: unknown) => void

/** Controllable WebSocket: records sent frames + lets the test drive events. */
class MockWs {
  static instances: MockWs[] = []
  static reset(): void {
    MockWs.instances = []
  }
  sent: string[] = []
  closed = false
  readyState = 0
  private listeners: Record<string, Listener[]> = { open: [], message: [], close: [], error: [] }
  constructor(public url: string) {
    MockWs.instances.push(this)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
    this.readyState = 3
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners[type].push(listener)
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener)
  }
  emit(type: string, event?: unknown): void {
    for (const l of [...this.listeners[type]]) {
      l(event)
    }
  }
  lastMethod(): string {
    return JSON.parse(this.sent[0]).method
  }
}

const factory = (url: string): WebSocketLike => new MockWs(url) as unknown as WebSocketLike

/** Drain microtasks so the async fallback (reject → catch → retry) runs. The
 *  suite runs under fake timers, so a setTimeout-based flush would never fire. */
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

const resultFrame = (token: string) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { token } })
const errorFrame = (error: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 1, error })

describe('pairOverAcp', () => {
  beforeEach(() => MockWs.reset())

  it('sends volt/pair with the code and resolves the issued token', async () => {
    const p = pairOverAcp({ url: 'wss://gw/acp', code: 'ABC123', webSocketFactory: factory })
    const ws = MockWs.instances[0]
    ws.emit('open')

    expect(JSON.parse(ws.sent[0])).toMatchObject({ jsonrpc: '2.0', method: 'volt/pair', params: { code: 'ABC123' } })

    ws.emit('message', { data: resultFrame('zc_x') })
    await expect(p).resolves.toEqual({ token: 'zc_x' })
    expect(ws.closed).toBe(true)
  })

  it('falls back to zeroclaw/pair when volt/pair is unknown, then resolves', async () => {
    const p = pairOverAcp({ url: 'wss://gw/acp', code: 'ABC', webSocketFactory: factory })
    const ws1 = MockWs.instances[0]
    ws1.emit('open')
    expect(ws1.lastMethod()).toBe('volt/pair')

    ws1.emit('message', { data: errorFrame({ code: -32601, message: 'method not found' }) })
    await flush()

    const ws2 = MockWs.instances[1]
    expect(ws2).toBeDefined()
    ws2.emit('open')
    expect(ws2.lastMethod()).toBe('zeroclaw/pair')

    ws2.emit('message', { data: resultFrame('zc_y') })
    await expect(p).resolves.toEqual({ token: 'zc_y' })
  })

  it('also falls back on the pre-auth pair_first refusal', async () => {
    const p = pairOverAcp({ url: 'wss://gw/acp', code: 'ABC', webSocketFactory: factory })
    MockWs.instances[0].emit('open')
    MockWs.instances[0].emit('message', {
      data: errorFrame({ message: 'auth required', data: { reason: 'pair_first' } }),
    })
    await flush()
    const ws2 = MockWs.instances[1]
    expect(ws2).toBeDefined()
    ws2.emit('open')
    expect(ws2.lastMethod()).toBe('zeroclaw/pair')
    ws2.emit('message', { data: resultFrame('zc_z') })
    await expect(p).resolves.toEqual({ token: 'zc_z' })
  })

  it('rejects a bad code as invalid_code (no fallback)', async () => {
    const p = pairOverAcp({ url: 'wss://gw/acp', code: 'BAD', webSocketFactory: factory })
    const ws = MockWs.instances[0]
    ws.emit('open')
    ws.emit('message', { data: errorFrame({ code: -32000, message: 'invalid pairing code' }) })
    await expect(p).rejects.toMatchObject({ kind: 'invalid_code' })
    expect(MockWs.instances).toHaveLength(1) // did NOT retry
  })

  it('rejects a transport failure', async () => {
    const p = pairOverAcp({ url: 'wss://gw/acp', code: 'X', webSocketFactory: factory })
    MockWs.instances[0].emit('error', { message: 'boom' })
    const err = await p.catch((e) => e)
    expect(err).toBeInstanceOf(PairingError)
    expect(err.kind).toBe('transport')
  })

  it('rejects and closes the socket on timeout', async () => {
    const p = pairOverAcp({ url: 'wss://gw/acp', code: 'X', timeoutMs: 10, webSocketFactory: factory })
    const settled = p.catch((e: unknown) => e) // pre-attach before the clock tick rejects p
    const ws = MockWs.instances[0]
    ws.emit('open')
    await getClock().tickAsync(11) // fake timers: advance past the 10ms timeout
    const err = await settled
    expect(err).toBeInstanceOf(PairingError)
    expect((err as PairingError).kind).toBe('timeout')
    expect(ws.closed).toBe(true)
  })
})
