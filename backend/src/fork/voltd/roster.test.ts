/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { fetchVoltdRoster } from './roster'

/** Minimal scriptable stand-in for the global WebSocket. */
class FakeSocket {
  static last: FakeSocket | null = null
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  closed = false

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.last = this
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.onclose?.()
  }
}

const factory = (url: string, protocols: string[]) => new FakeSocket(url, protocols) as unknown as WebSocket

const message = (payload: unknown) => ({ data: JSON.stringify(payload) }) as MessageEvent

/** Drive a roster fetch, running `script` once the socket has opened. */
const run = async (script: (socket: FakeSocket) => void, timeoutMs = 50) => {
  const promise = fetchVoltdRoster({
    gatewayUrl: 'wss://gateway.internal:8443/acp',
    token: 'minted.jwt.value',
    timeoutMs,
    webSocketFactory: factory,
  })
  const socket = FakeSocket.last!
  socket.onopen?.()
  script(socket)
  return promise
}

const initializeResult = (agents: unknown) => ({
  jsonrpc: '2.0',
  id: 1,
  result: { protocolVersion: 1, _meta: { zeroclaw: { agents } } },
})

describe('fetchVoltdRoster', () => {
  it('offers the bearer as a subprotocol and sends one initialize frame', async () => {
    const roster = await run((socket) => socket.onmessage?.(message(initializeResult([]))))
    expect(roster).toEqual([])

    const socket = FakeSocket.last!
    expect(socket.protocols).toEqual(['volt.acp.v1', 'zeroclaw.acp.v1', 'bearer.minted.jwt.value'])
    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0])).toMatchObject({ id: 1, method: 'initialize' })
  })

  it('reads the roster out of the initialize result', async () => {
    const roster = await run((socket) =>
      socket.onmessage?.(
        message(
          initializeResult([
            { alias: 'crm_bot', display_name: 'CRM', default: true },
            { alias: 'payroll_bot' },
          ]),
        ),
      ),
    )
    expect(roster).toEqual([
      { alias: 'crm_bot', displayName: 'CRM', isDefault: true },
      { alias: 'payroll_bot', displayName: null, isDefault: false },
    ])
  })

  it('treats a gateway with no agent catalogue as an empty roster, not a failure', async () => {
    const roster = await run((socket) => socket.onmessage?.(message({ jsonrpc: '2.0', id: 1, result: {} })))
    expect(roster).toEqual([])
  })

  it('drops entries with no usable alias', async () => {
    const roster = await run((socket) =>
      socket.onmessage?.(message(initializeResult([{ alias: '  ' }, { alias: 7 }, { alias: 'ok' }]))),
    )
    expect(roster.map((a) => a.alias)).toEqual(['ok'])
  })

  it('ignores frames that are not the answer to our request', async () => {
    const roster = await run((socket) => {
      socket.onmessage?.(message({ jsonrpc: '2.0', method: 'session/update', params: {} }))
      socket.onmessage?.(message({ jsonrpc: '2.0', id: 99, result: {} }))
      socket.onmessage?.(message(initializeResult([{ alias: 'crm_bot' }])))
    })
    expect(roster.map((a) => a.alias)).toEqual(['crm_bot'])
  })

  // The distinction matters: an empty roster means "you may use nothing", while a
  // rejection means "we could not ask" — and the provider turns only the latter
  // into a failed discovery response so the client keeps its existing agents.
  it('rejects when the gateway refuses initialize', async () => {
    await expect(
      run((socket) =>
        socket.onmessage?.(message({ jsonrpc: '2.0', id: 1, error: { message: 'unauthorized' } })),
      ),
    ).rejects.toThrow(/unauthorized/)
  })

  it('rejects when the socket closes before answering', async () => {
    await expect(run((socket) => socket.onclose?.())).rejects.toThrow(/closed the socket/)
  })

  it('rejects when the transport fails', async () => {
    await expect(run((socket) => socket.onerror?.())).rejects.toThrow(/socket failed/)
  })

  it('rejects on timeout', async () => {
    await expect(run(() => {}, 10)).rejects.toThrow(/timed out/)
  })

  it('closes the socket on success', async () => {
    await run((socket) => socket.onmessage?.(message(initializeResult([]))))
    expect(FakeSocket.last!.closed).toBe(true)
  })

  it('refuses to probe without a token', async () => {
    await expect(
      fetchVoltdRoster({ gatewayUrl: 'wss://g/acp', token: '  ', webSocketFactory: factory }),
    ).rejects.toThrow(/requires a token/)
  })
})
