/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * End-to-end over a REAL WebSocket, against a local server that speaks the slice
 * of ACP this feature depends on.
 *
 * The other tests in this folder stub the socket, which cannot catch a subprotocol
 * the server refuses, a frame shape it does not recognise, or a real close. A live
 * probe against the pilot gateway got as far as
 * `voltd rejected initialize: pair first via zeroclaw/pair` — proof the handshake
 * and bearer reach a real voltd, but not the happy path, because that gateway's
 * configured issuer is not us. This fills in the rest with a gateway we control.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { Auth } from '@/auth/elysia-plugin'
import { encodeWsBearer, wsBearerSubprotocolPrefix } from '@shared/ws-bearer'
import { voltCarrierSubprotocol } from '@shared/zeroclaw-acp'
import type { Server } from 'bun'
import { createVoltdAgentProvider } from './provider'
import { createVoltdRelayHandlers } from './relay'
import { fetchVoltdRoster } from './roster'
import type { VoltdTokenService } from './token'

type Received = { protocol: string | null; token: string | null; frames: string[] }

let server: Server<{ token: string | null }>
let received: Received

/** A gateway that answers `initialize` with a roster, and echoes anything else. */
const startGateway = () =>
  Bun.serve<{ token: string | null }>({
    port: 0,
    fetch(request, srv) {
      const offered = request.headers.get('sec-websocket-protocol') ?? ''
      const entries = offered.split(',').map((entry) => entry.trim())
      const bearer = entries.find((entry) => entry.startsWith('bearer.')) ?? null
      received.protocol = entries.includes(voltCarrierSubprotocol) ? voltCarrierSubprotocol : null
      received.token = bearer ? bearer.slice('bearer.'.length) : null

      // Echo the carrier, as the real gateway does; never the bearer.
      const upgraded = srv.upgrade(request, {
        data: { token: received.token },
        headers: received.protocol ? { 'sec-websocket-protocol': received.protocol } : undefined,
      })
      return upgraded ? undefined : new Response('expected a websocket upgrade', { status: 400 })
    },
    websocket: {
      message(ws, message) {
        const text = String(message)
        received.frames.push(text)
        const frame = JSON.parse(text) as { id?: number; method?: string }
        if (frame.method === 'initialize') {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: frame.id,
              result: {
                protocolVersion: 1,
                _meta: {
                  zeroclaw: {
                    agents: [
                      { alias: 'crm_bot', display_name: 'CRM', default: true },
                      { alias: 'payroll_bot' },
                    ],
                  },
                },
              },
            }),
          )
          return
        }
        ws.send(JSON.stringify({ echo: frame }))
      },
    },
  })

const gatewayUrl = () => `ws://127.0.0.1:${server.port}/acp`

const service = (): VoltdTokenService => ({
  issuer: 'https://backend.volt.example/v1',
  audience: 'volt',
  ttlSeconds: 900,
  jwks: { keys: [] },
  mint: async ({ userId, groups }) => `token.${userId}.${groups.join('+')}`,
})

beforeAll(() => {
  received = { protocol: null, token: null, frames: [] }
  server = startGateway()
})

afterAll(() => {
  server.stop(true)
})

describe('voltd roster over a real socket', () => {
  it('negotiates the carrier, carries the bearer, and reads the roster', async () => {
    received = { protocol: null, token: null, frames: [] }
    const roster = await fetchVoltdRoster({ gatewayUrl: gatewayUrl(), token: 'minted.jwt', timeoutMs: 5000 })

    expect(roster).toEqual([
      { alias: 'crm_bot', displayName: 'CRM', isDefault: true },
      { alias: 'payroll_bot', displayName: null, isDefault: false },
    ])
    // The gateway saw the carrier it expects and the bearer, unencoded.
    expect(received.protocol).toBe(voltCarrierSubprotocol)
    expect(received.token).toBe('minted.jwt')
    // Exactly one frame: initialize. No session is started.
    expect(received.frames).toHaveLength(1)
    expect(JSON.parse(received.frames[0]).method).toBe('initialize')
  })

  it('rejects, rather than reporting an empty roster, when the gateway is not there', async () => {
    await expect(
      fetchVoltdRoster({ gatewayUrl: `ws://127.0.0.1:${server.port + 1}/acp`, token: 't', timeoutMs: 3000 }),
    ).rejects.toThrow()
  })
})

describe('voltd discovery over a real socket', () => {
  it('turns the live roster into relay-pointed descriptors', async () => {
    received = { protocol: null, token: null, frames: [] }
    const provider = createVoltdAgentProvider({
      service: service(),
      gatewayUrl: gatewayUrl(),
      resolveUser: async () => ({ id: 'user-1', isAnonymous: false, groups: ['volt-crm'] }) as never,
    })!

    const descriptors = await provider.list(
      new Request('https://backend.volt.example/v1/agents'),
      {} as never,
    )

    expect(descriptors.map((d) => d.id)).toEqual(['voltd-crm_bot', 'voltd-payroll_bot'])
    expect(descriptors[0].url).toBe('wss://backend.volt.example/v1/voltd/ws?agent=crm_bot')
    expect(descriptors.every((d) => d.type === 'managed-acp' && d.isSystem === 1)).toBe(true)
    // The user's own groups reached the gateway, via the minted token.
    expect(received.token).toBe('token.user-1.volt-crm')
  })
})

describe('voltd relay over a real socket', () => {
  const authorized = (): Auth =>
    ({
      api: { getSession: () => Promise.resolve({ user: { id: 'user-1', isAnonymous: false }, session: {} }) },
    }) as unknown as Auth

  const client = () => {
    const sent: unknown[] = []
    const closes: Array<{ code?: number; reason?: string }> = []
    return {
      ws: {
        data: {
          request: new Request('https://backend.volt.example/v1/voltd/ws?agent=crm_bot', {
            headers: { 'sec-websocket-protocol': `${wsBearerSubprotocolPrefix}${encodeWsBearer('session.sig')}` },
          }),
        },
        send: (frame: unknown) => sent.push(frame),
        close: (code?: number, reason?: string) => closes.push({ code, reason }),
      },
      sent,
      closes,
    }
  }

  it('relays a frame to the gateway and its reply back to the client', async () => {
    received = { protocol: null, token: null, frames: [] }
    const handlers = createVoltdRelayHandlers({
      auth: authorized(),
      service: service(),
      gatewayUrl: gatewayUrl(),
    })
    const downstream = client()

    await handlers.open(downstream.ws)
    // Queued before the upstream is ready, flushed once it opens.
    handlers.message(downstream.ws, JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'session/new' }))

    await Bun.sleep(300)

    expect(received.frames.map((frame) => JSON.parse(frame).method)).toContain('session/new')
    expect(downstream.sent).toHaveLength(1)
    expect(JSON.parse(String(downstream.sent[0])).echo).toMatchObject({ id: 7, method: 'session/new' })
    expect(received.token).toBe('token.user-1.')

    handlers.close(downstream.ws, 1000)
  })

  it('closes the client when the gateway is unreachable', async () => {
    const handlers = createVoltdRelayHandlers({
      auth: authorized(),
      service: service(),
      gatewayUrl: `ws://127.0.0.1:${server.port + 1}/acp`,
    })
    const downstream = client()

    await handlers.open(downstream.ws)
    await Bun.sleep(300)

    expect(downstream.closes.length).toBeGreaterThan(0)
    handlers.close(downstream.ws, 1006)
  })
})
