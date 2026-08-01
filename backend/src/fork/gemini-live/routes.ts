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
import { authorizeWsBearer, wsCloseUnauthorized } from '@/auth/ws-bearer-auth'
import { safeErrorHandler } from '@/middleware/error-handling'
import { wsCarrierSubprotocol } from '@shared/ws-bearer'
import { Elysia, type AnyElysia } from 'elysia'

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

      // A raw WebSocket can't carry an `Authorization` header, so auth rides a
      // `thunderbolt.bearer.<token>` subprotocol entry, validated here in
      // `open()` (NOT `beforeHandle`, which Bun may invoke more than once per
      // upgrade) via the same signed-bearer path REST uses. Anonymous users and
      // missing/invalid bearers are rejected — mirrors the haystack ACP route.
      const subprotocolHeader = data.request?.headers.get('sec-websocket-protocol') ?? null
      const user = await authorizeWsBearer(auth, subprotocolHeader)
      if (!user) {
        ws.close(wsCloseUnauthorized, 'unauthorized')
        return
      }

      if (!apiKey) {
        ws.close(1008, 'Gemini provider not configured')
        return
      }

      // Model selects the upstream endpoint version only — never forwarded upstream.
      const model = data.query?.model || 'gemini-2.0-flash-live-001'
      const upstreamUrl = upstreamUrlFor(model, apiKey)

      const state: RelayState = {
        upstream: null,
        pending: [],
        upstreamReady: false,
        closing: false,
      }
      ;(ws.data as Record<string, unknown>).relay = state

      let upstream: WebSocket
      try {
        upstream = new WebSocket(upstreamUrl)
      } catch {
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
      const upstream = state?.upstream
      if (!state || !upstream || state.closing) {
        return
      }

      const frame = coerceToFrame(message)

      if (messageByteLength(frame) > maxFrameBytes) {
        state.closing = true
        safeClose(ws, 1009, 'frame too large')
        safeClose(upstream)
        return
      }

      if (state.upstreamReady) {
        upstream.send(frame as never)
        return
      }

      if (state.pending.length >= maxPending) {
        state.closing = true
        safeClose(ws, 1009, 'buffer overflow')
        safeClose(upstream)
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
