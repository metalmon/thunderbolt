/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Gemini Live WebSocket proxy — bridges the client to Google's
 * `generativelanguage.googleapis.com` WebSocket endpoint with the server-side
 * API key injected. The key never reaches the client.
 *
 * Client connects to `/v1/gemini-live`; this route upgrades and bridges to
 * Google's `wss://generativelanguage.googleapis.com/ws/` with the API key.
 */

import type { Auth } from '@/auth/elysia-plugin'
import { createAuthMacro } from '@/auth/elysia-plugin'
import { safeErrorHandler } from '@/middleware/error-handling'
import { Elysia, type AnyElysia } from 'elysia'

const GEMINI_WS_BASE = 'wss://generativelanguage.googleapis.com/ws'

export type CreateGeminiLiveRoutesOptions = {
  auth: Auth
  rateLimit?: AnyElysia
  /** Override the Gemini API key. Defaults to `GEMINI_API_KEY` env. */
  apiKey?: string
}

/** Per-connection state: the upstream WebSocket to Google. */
type UpstreamState = {
  upstream: WebSocket | null
  pending: Array<string | ArrayBuffer | Uint8Array>
  upstreamReady: boolean
}

export const createGeminiLiveRoutes = (options: CreateGeminiLiveRoutesOptions) => {
  const { auth, rateLimit } = options
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY

  return new Elysia({ prefix: '/gemini-live' })
    .onError(safeErrorHandler)
    .use(createAuthMacro(auth))
    .guard({ auth: true }, (g) => {
      if (rateLimit) {
        g.use(rateLimit)
      }

      return g.ws('/', {
        open(ws) {
          if (!apiKey) {
            ws.close(1008, 'Gemini provider not configured')
            return
          }

          // Extract model from query params on the original request URL.
          const data = ws.data as { query?: Record<string, string> }
          const model = data?.query?.model || 'gemini-2.0-flash-live-001'

          const upstreamUrl = `${GEMINI_WS_BASE}?key=${apiKey}&model=${model}`

          const state: UpstreamState = {
            upstream: null,
            pending: [],
            upstreamReady: false,
          }
          ;(ws.data as Record<string, unknown>).relay = state

          try {
            const upstream = new WebSocket(upstreamUrl)
            state.upstream = upstream

            upstream.onopen = () => {
              state.upstreamReady = true
              for (const msg of state.pending) {
                upstream.send(msg as never)
              }
              state.pending = []
            }

            upstream.onmessage = (event) => {
              ws.send(event.data as never)
            }

            upstream.onerror = () => {
              ws.close(1011, 'Upstream connection error')
            }

            upstream.onclose = (event) => {
              ws.close(event.code, event.reason || 'Upstream closed')
            }
          } catch {
            ws.close(1011, 'Failed to connect to Gemini')
          }
        },

        message(ws, message) {
          const state = (ws.data as Record<string, unknown>).relay as UpstreamState | undefined
          if (!state?.upstream) {
            return
          }

          // Coerce Elysia's parsed message back to raw bytes/string for forwarding.
          const payload =
            typeof message === 'string' || message instanceof ArrayBuffer || message instanceof Uint8Array
              ? message
              : String(message)

          if (state.upstreamReady) {
            state.upstream.send(payload as never)
            return
          }

          state.pending.push(payload as never)
        },

        close(ws, code, reason) {
          const state = (ws.data as Record<string, unknown>).relay as UpstreamState | undefined
          if (state?.upstream && state.upstream.readyState === WebSocket.OPEN) {
            state.upstream.close(code, typeof reason === 'string' ? reason : undefined)
          }
        },
      })
    })
}
