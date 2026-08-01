/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mockAuth } from '@/test-utils/mock-auth'
import { encodeWsBearer } from '@shared/ws-bearer'
import { createGeminiLiveRoutes, upstreamUrlFor, maxFrameBytes, maxPending } from './routes'

/** Offer the carrier + a bearer subprotocol, exactly as the real client does
 *  (see `createProxyWebSocket` / `gemini-live-engine.ts`). `mockAuth` accepts
 *  any token, so the exact value only needs to be non-empty and decodable. */
const bearerProtocols = (token: string): string[] => ['thunderbolt.v1', `thunderbolt.bearer.${encodeWsBearer(token)}`]

describe('Gemini Live routes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('creates a route without crashing', async () => {
    const app = createGeminiLiveRoutes({ auth: mockAuth, apiKey: '' })
    // WebSocket routes don't respond to plain HTTP GET — they expect a WS upgrade.
    // Verify the route is created and doesn't throw on any request.
    const res = await app.handle(new Request('http://localhost/gemini-live/'))
    expect(res).toBeDefined()
    expect(typeof res.status).toBe('number')
  })

  it('creates a route when using env variable', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const app = createGeminiLiveRoutes({ auth: mockAuth })
    const res = await app.handle(new Request('http://localhost/gemini-live/'))
    expect(res).toBeDefined()
  })
})

describe('upstreamUrlFor', () => {
  const originalOverride = process.env.GEMINI_WS_OVERRIDE

  afterEach(() => {
    if (originalOverride === undefined) {
      delete process.env.GEMINI_WS_OVERRIDE
    } else {
      process.env.GEMINI_WS_OVERRIDE = originalOverride
    }
  })

  it('uses v1beta BidiGenerateContent path for half-cascade + no model query', () => {
    const u = upstreamUrlFor('gemini-live-2.5-flash-preview', 'KEY123')
    expect(u).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=KEY123',
    )
  })
  it('uses v1alpha for native-audio models', () => {
    const u = upstreamUrlFor('gemini-2.5-flash-native-audio-preview', 'KEY123')
    expect(u).toContain('v1alpha.GenerativeService.BidiGenerateContent')
  })
  it('honors GEMINI_WS_OVERRIDE and skips the real endpoint computation entirely', () => {
    process.env.GEMINI_WS_OVERRIDE = 'ws://127.0.0.1:9999/mock-upstream'
    expect(upstreamUrlFor('gemini-2.5-flash-native-audio-preview', 'KEY123')).toBe('ws://127.0.0.1:9999/mock-upstream')
  })
  it('computes the real endpoint when GEMINI_WS_OVERRIDE is absent', () => {
    delete process.env.GEMINI_WS_OVERRIDE
    expect(upstreamUrlFor('gemini-live-2.5-flash-preview', 'KEY123')).toContain('generativelanguage.googleapis.com')
  })
})

/** A tiny "upstream" WebSocket server backed by Bun.serve, standing in for
 *  Google's Gemini Live endpoint. `openDelayMs` lets tests widen the window
 *  during which the relay's upstream socket is still CONNECTING, so
 *  pre-open buffering can be exercised deterministically. */
const startMockUpstream = (
  handlers: {
    open?: (ws: { send: (data: unknown) => unknown; close: (code?: number, reason?: string) => void }) => void
    message?: (
      ws: { send: (data: unknown) => unknown; close: (code?: number, reason?: string) => void },
      message: string | Buffer,
    ) => void
    close?: () => void
  } = {},
  openDelayMs = 0,
) => {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req, srv) {
      if (openDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, openDelayMs))
      }
      if (srv.upgrade(req)) {
        return
      }
      return new Response('not a ws request', { status: 400 })
    },
    websocket: {
      open: (ws) => handlers.open?.(ws as never),
      message: (ws, msg) => handlers.message?.(ws as never, msg as string | Buffer),
      close: () => handlers.close?.(),
    },
  })
  return {
    url: `ws://127.0.0.1:${server.port}`,
    stop: async () => {
      server.stop(true)
    },
  }
}

type RunningApp = {
  listen: (port: { port: number; hostname?: string }, callback?: () => void) => unknown
  stop: (closeActiveConnections?: boolean) => Promise<void> | void
  server: { port: number } | null
}

const startApp = async (app: RunningApp): Promise<number> => {
  await new Promise<void>((resolve) => {
    app.listen({ port: 0, hostname: '127.0.0.1' }, () => resolve())
  })
  return app.server!.port
}

const stopApp = async (app: RunningApp): Promise<void> => {
  await Promise.race([Promise.resolve(app.stop(true)), new Promise((r) => setTimeout(r, 500))])
}

/** Wait for a WebSocket close event and return its code/reason. */
const waitForClose = (ws: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => {
    ws.addEventListener('close', (event: CloseEvent) => resolve({ code: event.code, reason: event.reason }))
  })

/** Resolve with the first `message` event on `ws`. Bind before the trigger so
 *  no event is missed. */
const nextMessage = (ws: WebSocket, timeoutMs = 5000): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`nextMessage timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMessage = (e: MessageEvent) => {
      cleanup()
      resolve(e.data)
    }
    const cleanup = () => {
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
    }
    ws.addEventListener('message', onMessage)
  })

const waitForOpen = (ws: WebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve())
    ws.addEventListener('error', () => reject(new Error('client errored before open')))
  })

type WaitForOptions = { timeoutMs?: number; intervalMs?: number; label?: string }

const waitFor = async (predicate: () => boolean, options: WaitForOptions = {}): Promise<void> => {
  const { timeoutMs = 5000, intervalMs = 5, label = 'condition' } = options
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  if (predicate()) {
    return
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms waiting for ${label}`)
}

describe('Gemini Live relay — real WS upgrade against a mock upstream', () => {
  const originalOverride = process.env.GEMINI_WS_OVERRIDE
  let apps: RunningApp[] = []
  let upstreams: Array<{ stop: () => Promise<void> }> = []

  afterEach(async () => {
    for (const app of apps) {
      await stopApp(app)
    }
    for (const u of upstreams) {
      await u.stop()
    }
    apps = []
    upstreams = []
    if (originalOverride === undefined) {
      delete process.env.GEMINI_WS_OVERRIDE
    } else {
      process.env.GEMINI_WS_OVERRIDE = originalOverride
    }
  })

  /** Point `upstreamUrlFor` at the mock upstream and boot the relay app on an
   *  ephemeral port. Returns a client-ready relay URL. */
  const bootRelay = async (mockUrl: string): Promise<string> => {
    process.env.GEMINI_WS_OVERRIDE = mockUrl
    const app = createGeminiLiveRoutes({ auth: mockAuth, apiKey: 'test-key' }) as unknown as RunningApp
    const port = await startApp(app)
    apps.push(app)
    return `ws://127.0.0.1:${port}/gemini-live/`
  }

  it('closes 4001 when no bearer subprotocol is offered (a bare WebSocket is unauthenticated)', async () => {
    const upstream = startMockUpstream()
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    // A bare socket — no `thunderbolt.bearer.*` entry — is exactly what the
    // pre-fix client sent. The server accepts the upgrade (echoing the carrier)
    // then rejects in `open()` with the app-defined unauthorized close code.
    const client = new WebSocket(relayUrl)
    const { code } = await waitForClose(client)
    expect([4001, 1006]).toContain(code)
  })

  it('forwards a client text frame to upstream verbatim', async () => {
    const received: Array<string | Buffer> = []
    const upstream = startMockUpstream({ message: (_ws, msg) => received.push(msg) })
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    await waitForOpen(client)
    client.send('hello gemini')
    await waitFor(() => received.length > 0, { label: 'upstream to receive text frame' })

    expect(received[0]).toBe('hello gemini')
    client.close()
  })

  it('forwards a JSON-shaped client text frame to upstream byte-for-byte (no relay-side JSON parsing)', async () => {
    // Elysia's ws message parser auto-JSON-parses text frames that start with
    // `{`/`[` before the route's `message()` handler ever sees them. The relay
    // must reconstruct the exact original string rather than corrupt it.
    const received: Array<string | Buffer> = []
    const upstream = startMockUpstream({ message: (_ws, msg) => received.push(msg) })
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    await waitForOpen(client)
    const setupMessage = JSON.stringify({ setup: { model: 'gemini-2.0-flash-live-001' } })
    client.send(setupMessage)
    await waitFor(() => received.length > 0, { label: 'upstream to receive JSON frame' })

    expect(received[0]).toBe(setupMessage)
    client.close()
  })

  it('forwards an upstream text frame to the client verbatim', async () => {
    const upstream = startMockUpstream({ open: (ws) => ws.send('hello client') })
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    const msg = nextMessage(client)
    await waitForOpen(client)

    expect(await msg).toBe('hello client')
    client.close()
  })

  it('forwards binary frames verbatim in both directions', async () => {
    const received: Array<string | Buffer> = []
    const clientBytes = new Uint8Array([1, 2, 3, 4, 250])
    const upstreamBytes = new Uint8Array([9, 8, 7, 6, 5])
    const upstream = startMockUpstream({
      open: (ws) => ws.send(upstreamBytes),
      message: (_ws, msg) => received.push(msg),
    })
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    const firstFromUpstream = nextMessage(client)
    await waitForOpen(client)
    expect(Array.from(new Uint8Array((await firstFromUpstream) as Buffer))).toEqual(Array.from(upstreamBytes))

    client.send(clientBytes)
    await waitFor(() => received.length > 0, { label: 'upstream to receive binary frame' })
    expect(Array.from(new Uint8Array(received[0] as Buffer))).toEqual(Array.from(clientBytes))
    client.close()
  })

  it('buffers client frames sent before upstream opens and flushes them in order once it does', async () => {
    const received: Array<string | Buffer> = []
    // Delay the mock's WS handshake completion so the relay's upstream socket
    // stays CONNECTING while the client sends its first frames.
    const upstream = startMockUpstream({ message: (_ws, msg) => received.push(msg) }, 150)
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    await waitForOpen(client)
    client.send('a')
    client.send('b')
    client.send('c')

    await waitFor(() => received.length === 3, { label: 'all buffered frames to flush upstream', timeoutMs: 5000 })
    expect(received).toEqual(['a', 'b', 'c'])
    client.close()
  })

  it('closes with 1009 when a single frame exceeds MAX_FRAME_BYTES', async () => {
    const upstream = startMockUpstream()
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    await waitForOpen(client)
    const closed = waitForClose(client)
    client.send('x'.repeat(maxFrameBytes + 10))

    const { code } = await closed
    expect(code).toBe(1009)
  }, 10_000)

  it('closes with 1009 when the pre-open pending buffer exceeds MAX_PENDING', async () => {
    // Delay the mock's WS handshake completion well beyond this test's runtime
    // so the relay's upstream socket deterministically stays CONNECTING while
    // every client frame queues into `pending` until the cap fires. (Pointing
    // at an unreachable address instead races a near-instant connection-refused
    // error against the cap — see the sibling universal-proxy test for the
    // same caveat — so a real, merely-slow upstream is used instead.)
    const upstream = startMockUpstream({}, 10_000)
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    await waitForOpen(client)
    const closed = waitForClose(client)
    for (let i = 0; i < maxPending + 5; i++) {
      client.send(`frame-${i}`)
    }

    const { code } = await closed
    expect(code).toBe(1009)
  }, 10_000)

  it('propagates a client close to the upstream socket', async () => {
    let upstreamOpened = false
    let upstreamClosed = false
    const upstream = startMockUpstream({
      open: () => {
        upstreamOpened = true
      },
      close: () => (upstreamClosed = true),
    })
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    await waitForOpen(client)
    // Downstream open fires before the relay's upstream socket necessarily
    // finishes its own handshake — wait for the upstream side to actually
    // open so the close we trigger next exercises the OPEN-close path
    // (`upstream.close(code, reason)`), not the CONNECTING-abort path.
    await waitFor(() => upstreamOpened, { label: 'upstream to open before triggering client close' })
    client.close(1000, 'client done')

    await waitFor(() => upstreamClosed, { label: 'upstream to observe the close' })
    expect(upstreamClosed).toBe(true)
  })

  it('propagates an upstream close (code + reason) to the client', async () => {
    const upstream = startMockUpstream({ open: (ws) => ws.close(4400, 'upstream done') })
    upstreams.push(upstream)
    const relayUrl = await bootRelay(upstream.url)

    const client = new WebSocket(relayUrl, bearerProtocols('test-token'))
    const closed = waitForClose(client)

    const { code, reason } = await closed
    expect(code).toBe(4400)
    expect(reason).toBe('upstream done')
  })
})
