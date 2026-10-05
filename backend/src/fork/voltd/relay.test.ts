/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { createVoltdRelayHandlers, createVoltdRelayRoutes, exceedsQueueBudget } from './relay'
import type { Auth } from '@/auth/elysia-plugin'
import { encodeWsBearer, wsBearerSubprotocolPrefix } from '@shared/ws-bearer'
import type { VoltdTokenService } from './token'

describe('exceedsQueueBudget', () => {
  it('allows a frame that fits both budgets', () => {
    expect(exceedsQueueBudget(0, 0, 'hello')).toBe(false)
    expect(exceedsQueueBudget(63, 1024, 'hello')).toBe(false)
  })

  it('rejects the frame that would exceed the message count', () => {
    expect(exceedsQueueBudget(64, 0, 'x')).toBe(true)
  })

  it('rejects the frame that would exceed the byte budget', () => {
    expect(exceedsQueueBudget(0, 256 * 1024, 'x')).toBe(true)
  })

  it('measures binary frames by byte length, not character count', () => {
    expect(exceedsQueueBudget(0, 256 * 1024 - 4, new Uint8Array(8))).toBe(true)
    expect(exceedsQueueBudget(0, 256 * 1024 - 16, new Uint8Array(8))).toBe(false)
  })

  it('measures strings in UTF-8 bytes, so multi-byte text is not undercounted', () => {
    // Four Cyrillic characters are eight bytes, not four.
    expect(exceedsQueueBudget(0, 256 * 1024 - 5, 'тест')).toBe(true)
  })
})

const service = (): VoltdTokenService => ({
  issuer: 'https://backend.volt.example/v1',
  audience: 'volt',
  ttlSeconds: 900,
  jwks: { keys: [] },
  mint: async () => 'minted',
})

const auth = {} as Auth

describe('createVoltdRelayRoutes', () => {
  it('mounts nothing without a gateway, so the route cannot dial an unset target', () => {
    const routes = createVoltdRelayRoutes({ auth, service: service(), gatewayUrl: '' })
    expect(routes.routes).toHaveLength(0)
  })

  it('mounts nothing for a cleartext gateway outside loopback', () => {
    const routes = createVoltdRelayRoutes({ auth, service: service(), gatewayUrl: 'ws://gateway.internal/acp' })
    expect(routes.routes).toHaveLength(0)
  })

  it('mounts the relay for a wss gateway', () => {
    const routes = createVoltdRelayRoutes({ auth, service: service(), gatewayUrl: 'wss://gateway.internal/acp' })
    expect(routes.routes.length).toBeGreaterThan(0)
  })
})

/** Upstream stand-in: records what the relay did and lets the test fire events. */
class FakeUpstream {
  static created: FakeUpstream[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  sent: unknown[] = []
  closedWith: Array<number | undefined> = []
  bufferedAmount = 0

  constructor() {
    FakeUpstream.created.push(this)
  }

  send(frame: unknown) {
    this.sent.push(frame)
  }

  close(code?: number) {
    this.closedWith.push(code)
  }
}

const authorizedAuth = (): Auth =>
  ({
    api: { getSession: () => Promise.resolve({ user: { id: 'user-1', isAnonymous: false }, session: {} }) },
  }) as unknown as Auth

const downstream = () => {
  const closes: Array<{ code?: number; reason?: string }> = []
  const sent: unknown[] = []
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
    closes,
    sent,
  }
}

/** Handlers whose `mint` is held open, so a test can act inside the await window. */
const heldHandlers = (overrides: Partial<Parameters<typeof createVoltdRelayHandlers>[0]> = {}) => {
  let release: (token: string) => void = () => {}
  const minted = new Promise<string>((resolve) => (release = resolve))
  const handlers = createVoltdRelayHandlers({
    auth: authorizedAuth(),
    service: { ...service(), mint: () => minted },
    gatewayUrl: 'wss://gateway.internal:8443/acp',
    wsFactory: () => new FakeUpstream() as unknown as WebSocket,
    ...overrides,
  })
  return { handlers, release: () => release('minted') }
}

describe('voltd relay handlers', () => {
  // Two distinct await windows, each needing its own guard: the close handler has
  // already run and seen no upstream, so any socket created afterwards would never
  // be closed by anything.
  it('opens no gateway socket when the client hangs up during authorization', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws } = downstream()

    const opening = handlers.open(ws)
    handlers.close(ws)
    release()
    await opening

    expect(FakeUpstream.created).toHaveLength(0)
  })

  it('opens no gateway socket when the client hangs up while the token is being minted', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws } = downstream()

    const opening = handlers.open(ws)
    // Let authorization settle so the pending await is the mint, not the session.
    await new Promise((resolve) => setTimeout(resolve, 0))
    handlers.close(ws)
    release()
    await opening

    expect(FakeUpstream.created).toHaveLength(0)
  })

  // Elysia hands each callback its OWN wrapper object (`new ElysiaWS(ws, context)` in
  // open, message and close alike) around one shared `data`. Every other test here
  // reuses a single object and so cannot see it: keyed on the wrapper, the state
  // `open` stored is invisible to `message`, which drops the frame in silence and
  // leaves the client's ACP handshake to time out.
  it('forwards frames when every callback gets its own socket wrapper, as Elysia does', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws } = downstream()
    // One `data` shared by all wrappers — that is the only thing Bun keeps per socket.
    const wrapper = () => ({ ...ws })

    const opening = handlers.open(wrapper())
    release()
    await opening
    const upstream = FakeUpstream.created[0]
    upstream.onopen?.()

    handlers.message(wrapper(), 'initialize')
    expect(upstream.sent).toEqual(['initialize'])

    handlers.close(wrapper())
    expect(upstream.closedWith).toHaveLength(1)
  })

  // Elysia parses an inbound JSON text frame into an object before the handler sees
  // it. Forwarded as an object, `WebSocket.send` writes `[object Object]` and the
  // gateway answers the connection with a parse error instead of the handshake.
  it('forwards an ACP request Elysia has already parsed as the JSON text it was', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws } = downstream()

    const opening = handlers.open(ws)
    release()
    await opening
    const upstream = FakeUpstream.created[0]
    upstream.onopen?.()

    handlers.message(ws, { jsonrpc: '2.0', id: 0, method: 'initialize' })
    expect(upstream.sent).toEqual(['{"jsonrpc":"2.0","id":0,"method":"initialize"}'])
  })

  it('queues frames that arrive before the gateway socket is ready, then flushes them in order', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws } = downstream()

    const opening = handlers.open(ws)
    handlers.message(ws, 'first')
    handlers.message(ws, 'second')
    release()
    await opening

    const upstream = FakeUpstream.created[0]
    expect(upstream.sent).toEqual([])
    upstream.onopen?.()
    expect(upstream.sent).toEqual(['first', 'second'])
  })

  it('closes the client when the gateway stops draining, instead of buffering without limit', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws, closes } = downstream()

    const opening = handlers.open(ws)
    release()
    await opening
    const upstream = FakeUpstream.created[0]
    upstream.onopen?.()

    upstream.bufferedAmount = 256 * 1024 + 1
    handlers.message(ws, 'one more')
    expect(closes[0]?.code).toBe(4008)
  })

  it('closes the gateway socket when the client disconnects', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws } = downstream()

    const opening = handlers.open(ws)
    release()
    await opening
    handlers.close(ws)

    expect(FakeUpstream.created[0].closedWith).toHaveLength(1)
  })

  it('caps concurrent sessions per user, and frees the slot when one closes', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers({ maxSessionsPerUser: 2 })

    const sockets = [downstream(), downstream(), downstream()]
    const opens = sockets.map((entry) => handlers.open(entry.ws))
    release()
    await Promise.all(opens)

    // Two dialled; the third was refused before the gateway was touched.
    expect(FakeUpstream.created).toHaveLength(2)
    expect(sockets[2].closes[0]?.code).toBe(4009)

    // Closing one frees its slot for the next connection.
    handlers.close(sockets[0].ws, 1000)
    const fourth = downstream()
    await handlers.open(fourth.ws)
    expect(FakeUpstream.created).toHaveLength(3)
    expect(fourth.closes).toHaveLength(0)
  })

  it('records one telemetry event per connection, with duration and close code', async () => {
    FakeUpstream.created = []
    const events: Array<Record<string, unknown>> = []
    const { handlers, release } = heldHandlers({
      observability: {
        proxyRequest: () => {},
        proxyWsRelay: (fields) => events.push(fields as unknown as Record<string, unknown>),
      },
    })
    const { ws } = downstream()

    const opening = handlers.open(ws)
    release()
    await opening
    handlers.close(ws, 1000)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ user_id: 'user-1', close_code: 1000, method: 'GET' })
    expect(events[0].target_url).toContain('agent=crm_bot')
    expect(typeof events[0].duration_ms).toBe('number')
  })

  it('categorises a queue-overflow close so alerting can key off it', async () => {
    FakeUpstream.created = []
    const events: Array<Record<string, unknown>> = []
    const { handlers, release } = heldHandlers({
      observability: {
        proxyRequest: () => {},
        proxyWsRelay: (fields) => events.push(fields as unknown as Record<string, unknown>),
      },
    })
    const { ws } = downstream()

    const opening = handlers.open(ws)
    release()
    await opening
    handlers.close(ws, 4008)

    expect(events[0].error_type).toBe('cap_exceeded')
  })

  it('forwards the gateway close code so a refusal stays distinguishable', async () => {
    FakeUpstream.created = []
    const { handlers, release } = heldHandlers()
    const { ws, closes } = downstream()

    const opening = handlers.open(ws)
    release()
    await opening
    FakeUpstream.created[0].onclose?.({ code: 4001, reason: 'no agents' } as CloseEvent)

    expect(closes[0]).toEqual({ code: 4001, reason: 'no agents' })
  })
})
