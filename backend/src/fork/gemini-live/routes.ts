/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Gemini Live WebSocket relay — a pure byte passthrough between the client
 * and Google's `generativelanguage.googleapis.com` WebSocket endpoint, with
 * the server-side API key injected. The key never reaches the client.
 *
 * Client connects to `/v1/gemini-live`; this route upgrades and relays to
 * Google's `wss://generativelanguage.googleapis.com/ws/` with the API key.
 * The relay never parses or inspects message content: client frames are held
 * in a bounded buffer until the upstream socket opens, then every frame is
 * forwarded verbatim in both directions until either side closes.
 */

import type { Auth } from '@/auth/elysia-plugin'
import { extractBearerSubprotocol, wsCloseUnauthorized } from '@/auth/ws-bearer-auth'
import { safeErrorHandler } from '@/middleware/error-handling'
import type { User } from '@shared/types/auth'
import { wsCarrierSubprotocol } from '@shared/ws-bearer'
import { Elysia, type AnyElysia } from 'elysia'

/**
 * Authorize a voice WebSocket upgrade, admitting **anonymous** users.
 *
 * Unlike `authorizeWsBearer` (used by the ZeroClaw ACP/proxy relay, which must
 * reject anonymous sessions), the voice relay is a consumer/demo feature: the
 * fork runs `AUTH_ALLOW_ANONYMOUS=true` and the distributed binary is used by
 * anonymous users, so a valid anonymous session is a first-class caller here.
 * Still requires a decodable, valid bearer — only a missing/invalid/expired
 * token (no resolvable user) is rejected.
 */
const authorizeVoiceWsBearer = async (auth: Auth, subprotocolHeader: string | null): Promise<User | null> => {
  const token = extractBearerSubprotocol(subprotocolHeader)
  if (!token) {
    return null
  }
  const session = await auth.api.getSession({ headers: new Headers({ Authorization: `Bearer ${token}` }) })
  return (session?.user as User | undefined) ?? null
}

const nativeAudioPattern = /native-audio/

/** Test-only escape hatch: when set, `upstreamUrlFor` returns this URL
 *  verbatim instead of computing the real Google endpoint, so tests can point
 *  the relay at a local mock WebSocket server. Never set in production. */
export const upstreamUrlFor = (model: string, apiKey: string): string => {
  const override = process.env.GEMINI_WS_OVERRIDE
  if (override) {
    return override
  }
  const version = nativeAudioPattern.test(model) ? 'v1alpha' : 'v1beta'
  const svc = `google.ai.generativelanguage.${version}.GenerativeService.BidiGenerateContent`
  return `wss://generativelanguage.googleapis.com/ws/${svc}?key=${encodeURIComponent(apiKey)}`
}

export type CreateGeminiLiveRoutesOptions = {
  auth: Auth
  rateLimit?: AnyElysia
  /** Override the Gemini API key. Defaults to `GEMINI_API_KEY` env. */
  apiKey?: string
  /** HTTP(S) proxy for the upstream Gemini WebSocket. Defaults to the
   *  `GEMINI_LIVE_PROXY` env. Required where Google geo-blocks the server's
   *  region (e.g. RU → close code 1007 "User location is not supported"):
   *  Bun's `fetch` honors `HTTPS_PROXY`, but `new WebSocket()` does NOT, so the
   *  proxy must be passed explicitly here. Unset ⇒ direct connection. Only the
   *  upstream voice socket is proxied — the rest of the backend stays direct. */
  upstreamProxy?: string
}

/** Drop the connection (close code 1009 = "message too big") when a single
 *  frame exceeds this size. */
export const maxFrameBytes = 1024 * 1024

/** Drop the connection (close code 1009) when the pre-open buffer grows past
 *  this many queued frames. */
export const maxPending = 256

type RelayFrame = string | ArrayBuffer | Uint8Array

/** Per-connection state: the upstream WebSocket to Google and the bounded
 *  buffer of client frames held until it opens. */
type RelayState = {
  upstream: WebSocket | null
  pending: RelayFrame[]
  upstreamReady: boolean
  /** Set once either side has started closing, so the close/error handlers on
   *  both sides don't race each other into closing twice. */
  closing: boolean
}

const messageByteLength = (msg: RelayFrame): number =>
  typeof msg === 'string' ? Buffer.byteLength(msg, 'utf-8') : msg.byteLength

const safeClose = (target: { close: (code?: number, reason?: string) => void }, code?: number, reason?: string) => {
  try {
    target.close(code, reason)
  } catch {
    // already closed
  }
}

/** Elysia's ws parser auto-detects JSON/number/boolean/null in text frames
 *  before `message()` ever sees them (see Elysia's `createWSMessageParser`).
 *  Reconstruct the original frame so the relay stays a byte-for-byte
 *  passthrough instead of corrupting JSON payloads (e.g. Gemini's `setup`
 *  message) via a lossy `String(...)` coercion. */
const coerceToFrame = (message: unknown): RelayFrame => {
  if (typeof message === 'string' || message instanceof ArrayBuffer || message instanceof Uint8Array) {
    return message
  }
  return typeof message === 'object' ? JSON.stringify(message) : String(message)
}

export const createGeminiLiveRoutes = (options: CreateGeminiLiveRoutesOptions) => {
  const { auth, rateLimit } = options
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY
  const upstreamProxy = options.upstreamProxy ?? process.env.GEMINI_LIVE_PROXY

  const routes = new Elysia({ prefix: '/gemini-live' }).onError(safeErrorHandler)
  if (rateLimit) {
    routes.use(rateLimit)
  }

  return routes.ws('/', {
    // Echo the carrier subprotocol so strict WS clients (browsers, Bun) see
    // their offer accepted; the auth-bearing `thunderbolt.bearer.*` entry is
    // never echoed, keeping it off `WebSocket.protocol` and proxy logs.
    upgrade({ request, set }) {
      const subprotocolHeader = request.headers.get('sec-websocket-protocol')
      if (subprotocolHeader?.split(',').some((entry) => entry.trim() === wsCarrierSubprotocol)) {
        set.headers['sec-websocket-protocol'] = wsCarrierSubprotocol
      }
    },

    async open(ws) {
      const data = ws.data as unknown as { query?: Record<string, string>; request?: Request }

      // Install the relay state SYNCHRONOUSLY, before the async auth await below.
      // The client sends its `setup` frame the instant the socket opens, and Bun
      // may deliver it to `message()` while this async `open()` is still awaiting
      // `getSession`. `message()` drops frames whenever `state` is absent, so
      // deferring this assignment until after auth would silently swallow `setup`
      // — the upstream then opens but never receives it and Gemini stays mute
      // (client sees a live socket with no `setupComplete`, no audio). Buffering
      // into `pending` from frame zero is the whole point of that queue.
      const state: RelayState = {
        upstream: null,
        pending: [],
        upstreamReady: false,
        closing: false,
      }
      ;(ws.data as Record<string, unknown>).relay = state

      // A raw WebSocket can't carry an `Authorization` header, so auth rides a
      // `thunderbolt.bearer.<token>` subprotocol entry, validated here in
      // `open()` (NOT `beforeHandle`, which Bun may invoke more than once per
      // upgrade) via the same signed-bearer path REST uses. A missing/invalid
      // bearer is rejected; anonymous sessions are admitted (voice is a
      // consumer/demo feature — see `authorizeVoiceWsBearer`).
      const subprotocolHeader = data.request?.headers.get('sec-websocket-protocol') ?? null
      const user = await authorizeVoiceWsBearer(auth, subprotocolHeader)
      if (!user) {
        state.closing = true
        ws.close(wsCloseUnauthorized, 'unauthorized')
        return
      }

      if (!apiKey) {
        state.closing = true
        ws.close(1008, 'Gemini provider not configured')
        return
      }

      // Model selects the upstream endpoint version only — never forwarded upstream.
      // The client always sends `?model=` (see `resolveGeminiEngineOptions` in
      // `src/voice/engine/router.ts`), so this default is only a defensive
      // fallback — kept as one of the two currently-supported model ids
      // (half-cascade) rather than a removed one.
      const model = data.query?.model || 'gemini-3.1-flash-live-preview'
      const upstreamUrl = upstreamUrlFor(model, apiKey)

      let upstream: WebSocket
      try {
        // `{ proxy }` is a Bun extension — `new WebSocket()` ignores the
        // `HTTPS_PROXY` env (unlike `fetch`), so the geo-bypass proxy is passed
        // explicitly. Omitted entirely when unset for a plain direct dial. The
        // ambient (DOM) `WebSocket` type only declares `protocols: string[]` for
        // the 2nd arg, so cast Bun's option object through `unknown`.
        const wsInit = upstreamProxy ? { proxy: upstreamProxy } : undefined
        upstream = new WebSocket(upstreamUrl, wsInit as unknown as string[] | undefined)
      } catch {
        state.closing = true
        ws.close(1011, 'Failed to connect to Gemini')
        return
      }
      state.upstream = upstream

      upstream.onopen = () => {
        if (state.closing) {
          safeClose(upstream, 1000)
          return
        }
        state.upstreamReady = true
        for (const frame of state.pending) {
          upstream.send(frame as never)
        }
        state.pending = []
      }

      upstream.onmessage = (event) => {
        if (state.closing) {
          return
        }
        try {
          ws.send(event.data as never)
        } catch {
          // downstream already gone
        }
      }

      upstream.onerror = () => {
        if (state.closing) {
          return
        }
        state.closing = true
        safeClose(ws, 1011, 'Upstream connection error')
      }

      upstream.onclose = (event) => {
        if (state.closing) {
          return
        }
        state.closing = true
        safeClose(ws, event.code || 1000, event.reason || 'Upstream closed')
      }
    },

    message(ws, message) {
      const state = (ws.data as Record<string, unknown>).relay as RelayState | undefined
      if (!state || state.closing) {
        return
      }

      const frame = coerceToFrame(message)

      if (messageByteLength(frame) > maxFrameBytes) {
        state.closing = true
        safeClose(ws, 1009, 'frame too large')
        if (state.upstream) {
          safeClose(state.upstream)
        }
        return
      }

      // Forward straight through only once the upstream is open. Until then —
      // which includes the window during async auth, before the upstream even
      // exists — buffer into `pending`; `upstream.onopen` flushes it in order.
      // Requiring a non-null `upstream` to enqueue would defeat the buffer's
      // whole purpose: the client's `setup` (sent the instant it connects)
      // would be dropped, and Gemini closes an unconfigured socket with 1006.
      if (state.upstream && state.upstreamReady) {
        state.upstream.send(frame as never)
        return
      }

      if (state.pending.length >= maxPending) {
        state.closing = true
        safeClose(ws, 1009, 'buffer overflow')
        if (state.upstream) {
          safeClose(state.upstream)
        }
        return
      }

      state.pending.push(frame)
    },

    close(ws, code, reason) {
      const state = (ws.data as Record<string, unknown>).relay as RelayState | undefined
      if (!state || state.closing) {
        return
      }
      state.closing = true
      const upstream = state.upstream
      if (!upstream) {
        return
      }
      if (upstream.readyState === WebSocket.OPEN) {
        safeClose(upstream, code || 1000, typeof reason === 'string' ? reason : undefined)
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        safeClose(upstream)
      }
    },
  })
}
