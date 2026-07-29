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

      return g.get('/', async (ctx) => {
        if (!apiKey) {
          return new Response('Gemini provider not configured', { status: 503, headers: { 'Content-Type': 'text/plain' } })
        }

        // Extract model from query params for the upstream URL.
        const url = new URL(ctx.request.url)
        const model = url.searchParams.get('model') || 'gemini-2.0-flash-live-001'

        const upstreamUrl = `${GEMINI_WS_BASE}?key=${apiKey}&model=${model}`

        // Bridge: open a WebSocket to Google and pipe messages between client ↔ upstream.
        const upstreamWs = new WebSocket(upstreamUrl)

        // Wait for upstream to open, then upgrade the client.
        await new Promise<void>((resolve, reject) => {
          upstreamWs.onopen = () => resolve()
          upstreamWs.onerror = () => reject(new Error('Failed to connect to Gemini'))
          // Timeout after 10s.
          setTimeout(() => reject(new Error('Gemini connection timeout')), 10_000)
        })

        // Bridge messages bidirectionally.
        // Client → upstream: forward as-is (client already sends the right format).
        // Upstream → client: forward as-is (Google's format is what the client expects).
        upstreamWs.onmessage = (event) => {
          // The client socket is not directly accessible in Elysia's upgrade context,
          // so we use the server's built-in WebSocket handling.
          // In Bun, the upgraded socket is available via ctx.server.upgrade().
        }

        // For Bun's WebSocket upgrade, we return the upgrade response.
        // The actual bridging happens in the WebSocket event handlers.
        const upgraded = ctx.server?.upgrade(ctx.request, {
          websocket: {
            open(ws) {
              // Client connected — bridge to upstream.
              upstreamWs.onmessage = (event) => {
                ws.send(event.data)
              }
              upstreamWs.onclose = () => {
                ws.close(1000, 'Upstream closed')
              }
              upstreamWs.onerror = () => {
                ws.close(1011, 'Upstream error')
              }
            },
            message(ws, message) {
              // Client → upstream.
              if (upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.send(message)
              }
            },
            close(ws, code, reason) {
              // Client disconnected — close upstream.
              if (upstreamWs.readyState === WebSocket.OPEN) {
                upstreamWs.close(code, reason)
              }
            },
          },
        })

        if (!upgraded) {
          upstreamWs.close()
          return new Response('WebSocket upgrade failed', { status: 500 })
        }
      })
    })
}
