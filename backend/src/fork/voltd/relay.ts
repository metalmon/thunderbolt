/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `WS /v1/voltd/ws?agent=<alias>` — the ACP hop between the client and a voltd
 * gateway.
 *
 * The client authenticates to us the ordinary way, with its Better Auth bearer on
 * a subprotocol entry (`authorizeWsBearer`, exactly as the Haystack socket does).
 * We then mint that user's short-lived gateway token and open the upstream socket
 * ourselves, so the gateway credential never reaches the client and never needs
 * refreshing there.
 *
 * Not an open proxy: the gateway host comes from configuration alone, and only the
 * `agent` alias travels from the client — into the gateway's own alias namespace,
 * where voltd answers an alias the user may not use with `agent_not_permitted`.
 * Re-checking the roster here would cost a round trip per connection to re-derive
 * a decision the gateway makes anyway.
 */

import { authorizeWsBearer, wsCloseUnauthorized } from '@/auth/ws-bearer-auth'
import type { Auth } from '@/auth/elysia-plugin'
import { wsCloseCodes } from '@/proxy/ws'
import { wsCarrierSubprotocol } from '@shared/ws-bearer'
import type { User } from '@shared/types/auth'
import { buildAgentSubprotocols } from '@shared/zeroclaw-acp'
import { Elysia, type AnyElysia } from 'elysia'
import { isSecureGatewayUrl, readPrincipalGroups, type VoltdTokenService } from './token'

/** Pre-connect queue budget, mirroring the universal proxy's caps. */
const queueBytes = 256 * 1024
const queueMessages = 64

/** Exactly what `WebSocket.send` accepts, so relayed frames need no cast. */
type Frame = Parameters<WebSocket['send']>[0]

type RelayState = {
  upstream: WebSocket | null
  ready: boolean
  pending: Frame[]
  pendingBytes: number
}

export type CreateVoltdRelayRoutesOptions = {
  auth: Auth
  service: VoltdTokenService
  /** Gateway ACP endpoint, from `VOLTD_URL`. */
  gatewayUrl: string
  /** Test seam — production uses the global `WebSocket`. */
  wsFactory?: (url: string, protocols: string[]) => WebSocket
}

const frameBytes = (frame: Frame): number => {
  if (typeof frame === 'string') return Buffer.byteLength(frame, 'utf-8')
  return frame instanceof Blob ? frame.size : frame.byteLength
}

/**
 * Whether adding `frame` would push the pre-connect queue past either budget.
 * Extracted so the only arithmetic in the relay is testable without a socket.
 *
 * @param pendingCount - frames already queued
 * @param pendingBytes - bytes already queued
 * @param frame - the frame about to be queued
 */
export const exceedsQueueBudget = (pendingCount: number, pendingBytes: number, frame: Frame): boolean =>
  pendingCount + 1 > queueMessages || pendingBytes + frameBytes(frame) > queueBytes

const safeClose = (socket: { close: (code?: number, reason?: string) => void }, code?: number, reason?: string) => {
  try {
    socket.close(code, reason)
  } catch {
    // Already closed.
  }
}

/**
 * Build the relay plugin, or a plugin with no routes when no usable gateway is
 * configured — same inertness as the issuer routes, and the same refusal to dial a
 * cleartext gateway with a minted token.
 *
 * @param options - auth, token service, gateway URL, and the socket seam
 */
export const createVoltdRelayRoutes = (options: CreateVoltdRelayRoutesOptions): AnyElysia => {
  const base = new Elysia({ name: 'voltd-relay' })
  if (!isSecureGatewayUrl(options.gatewayUrl)) return base

  const factory = options.wsFactory ?? ((url, protocols) => new WebSocket(url, protocols))
  const states = new WeakMap<object, RelayState>()

  return base.ws('/voltd/ws', {
    upgrade({ request, set }) {
      // Echo the carrier so strict clients accept the upgrade; the bearer entry is
      // never echoed, keeping it off `WebSocket.protocol` and out of proxy logs.
      const offered = request.headers.get('sec-websocket-protocol')
      if (offered?.split(',').some((entry) => entry.trim() === wsCarrierSubprotocol)) {
        set.headers['sec-websocket-protocol'] = wsCarrierSubprotocol
      }
    },

    async open(ws) {
      const request = (ws.data as unknown as { request?: Request }).request
      const user: User | null = await authorizeWsBearer(options.auth, request?.headers.get('sec-websocket-protocol') ?? null)
      if (!user || user.isAnonymous) {
        ws.close(wsCloseUnauthorized, 'unauthorized')
        return
      }

      const alias = new URL(request?.url ?? 'http://localhost/v1/voltd/ws').searchParams.get('agent')?.trim()
      if (!alias) {
        ws.close(wsCloseUnauthorized, 'missing agent parameter')
        return
      }

      const state: RelayState = { upstream: null, ready: false, pending: [], pendingBytes: 0 }
      states.set(ws, state)

      const token = await options.service.mint({ userId: user.id, groups: readPrincipalGroups(user) })
      const target = new URL(options.gatewayUrl)
      target.searchParams.set('agent', alias)

      const upstream = (() => {
        try {
          return factory(target.toString(), buildAgentSubprotocols(token) ?? [])
        } catch (error) {
          ws.close(wsCloseCodes.internalError, error instanceof Error ? error.message : 'connect failed')
          return null
        }
      })()
      if (!upstream) return
      state.upstream = upstream

      upstream.onopen = () => {
        state.ready = true
        for (const frame of state.pending) upstream.send(frame)
        state.pending = []
        state.pendingBytes = 0
      }
      upstream.onmessage = (event: MessageEvent) => ws.send(event.data)
      upstream.onerror = () => safeClose(ws, wsCloseCodes.internalError, 'gateway socket failed')
      // Propagate the gateway's own code where it is a valid one to forward, so a
      // 401 on upgrade (no agents for this principal) stays distinguishable from
      // our own failures.
      upstream.onclose = (event: CloseEvent) =>
        safeClose(ws, event.code >= 1000 && event.code <= 4999 ? event.code : wsCloseCodes.internalError, event.reason)
    },

    message(ws, message) {
      const state = states.get(ws)
      if (!state) return
      const frame = message as Frame
      if (state.ready && state.upstream) {
        state.upstream.send(frame)
        return
      }
      // Still connecting upstream: hold a bounded amount rather than dropping
      // frames silently or growing without limit.
      if (exceedsQueueBudget(state.pending.length, state.pendingBytes, frame)) {
        safeClose(ws, wsCloseCodes.queueOverflow, 'pre-connect queue overflow')
        return
      }
      state.pending.push(frame)
      state.pendingBytes += frameBytes(frame)
    },

    close(ws) {
      const state = states.get(ws)
      if (state?.upstream) safeClose(state.upstream)
      states.delete(ws)
    },
  })
}
