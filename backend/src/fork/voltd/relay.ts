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
import { noopObservability, type ObservabilityRecorder } from '@/proxy/observability'
import { classifyWsCloseCode, wsCloseCodes } from '@/proxy/ws'
import { wsCarrierSubprotocol } from '@shared/ws-bearer'
import type { User } from '@shared/types/auth'
import { buildAgentSubprotocols } from '@shared/zeroclaw-acp'
import { Elysia, type AnyElysia } from 'elysia'
import { isSecureGatewayUrl, readPrincipalGroups, type VoltdTokenService } from './token'

/** Pre-connect queue budget, mirroring the universal proxy's caps. */
const queueBytes = 256 * 1024
const queueMessages = 64

/** How long the gateway gets to finish its handshake before we give up on it. */
const connectTimeoutMs = 10_000

/** Concurrent relayed sessions one user may hold. The sockets are long-lived and
 *  each pins one upstream connection to an on-prem gateway, so an authenticated
 *  client looping `new WebSocket` would otherwise exhaust both ends. */
const defaultMaxSessionsPerUser = 8

/** Close code for exceeding that cap — distinct from the queue cap so the two are
 *  distinguishable in the logs. */
const wsCloseTooManySessions = 4009

/** Exactly what `WebSocket.send` accepts, so relayed frames need no cast. */
type Frame = Parameters<WebSocket['send']>[0]

type RelayState = {
  upstream: WebSocket | null
  ready: boolean
  /** The downstream socket closed. Read by `open` after each await, which is the
   *  only thing that keeps a gateway socket created later from being orphaned. */
  closed: boolean
  /** Set once this socket has been counted against its user's session cap, so
   *  `close` decrements exactly once and no early return leaks a slot. */
  countedUserId: string | null
  openedAt: number
  targetUrl: string
  userId: string
  /** Armed while the gateway handshake is outstanding; cleared by whichever of
   *  open/close/error/timeout happens first. */
  connectTimer: ReturnType<typeof setTimeout> | null
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
  /** Per-connection telemetry, the same recorder the universal proxy uses.
   *  Defaults to the no-op so tests and unconfigured callers stay silent. */
  observability?: ObservabilityRecorder
  /** Request rate limiting, applied as the universal proxy applies it
   *  (`proxy/ws.ts`). */
  rateLimit?: AnyElysia
  /** Override the concurrent-session cap. */
  maxSessionsPerUser?: number
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
  // Elysia's WS hook type is deeply generic and not worth re-deriving: the handlers
  // are structurally correct and driven directly by the tests, so the seam is cast
  // here rather than contorting their signatures to match it.
  return base.ws('/voltd/ws', createVoltdRelayHandlers(options) as never)
}

/** The downstream socket surface the handlers actually use, so tests can supply a
 *  plain object instead of standing up a WebSocket upgrade. */
export type RelayDownstream = {
  data: unknown
  send: (frame: Frame) => unknown
  close: (code?: number, reason?: string) => void
}

/**
 * The socket handlers, separate from the route so the parts worth testing — the
 * close-during-await race and the queue budgets — can be driven directly.
 *
 * @param options - auth, token service, gateway URL, and the socket seam
 */
export const createVoltdRelayHandlers = (options: CreateVoltdRelayRoutesOptions) => {
  const factory = options.wsFactory ?? ((url, protocols) => new WebSocket(url, protocols))
  const states = new WeakMap<object, RelayState>()
  const observability = options.observability ?? noopObservability
  const maxSessions = options.maxSessionsPerUser ?? defaultMaxSessionsPerUser
  /** Live relayed sessions per user id. Only grows while sockets are open. */
  const sessionsPerUser = new Map<string, number>()

  const release = (state: RelayState) => {
    if (!state.countedUserId) return
    const remaining = (sessionsPerUser.get(state.countedUserId) ?? 1) - 1
    if (remaining > 0) sessionsPerUser.set(state.countedUserId, remaining)
    else sessionsPerUser.delete(state.countedUserId)
    state.countedUserId = null
  }

  return {
    upgrade({ request, set }: { request: Request; set: { headers: Record<string, string> } }) {
      // Echo the carrier so strict clients accept the upgrade; the bearer entry is
      // never echoed, keeping it off `WebSocket.protocol` and out of proxy logs.
      const offered = request.headers.get('sec-websocket-protocol')
      if (offered?.split(',').some((entry) => entry.trim() === wsCarrierSubprotocol)) {
        set.headers['sec-websocket-protocol'] = wsCarrierSubprotocol
      }
    },

    async open(ws: RelayDownstream) {
      // Register before the first await. Authorizing and minting are async, and a
      // client may both send frames and hang up during that window: without the
      // state those frames are dropped unbounded-by-nothing, and without the
      // `closed` flag below the socket we are about to open to the gateway would
      // outlive the client that asked for it, forever.
      const state: RelayState = {
        upstream: null,
        ready: false,
        closed: false,
        countedUserId: null,
        openedAt: Date.now(),
        targetUrl: '',
        userId: '',
        connectTimer: null,
        pending: [],
        pendingBytes: 0,
      }
      states.set(ws, state)

      const request = (ws.data as unknown as { request?: Request }).request
      const user: User | null = await authorizeWsBearer(options.auth, request?.headers.get('sec-websocket-protocol') ?? null)
      if (state.closed) return
      if (!user || user.isAnonymous) {
        ws.close(wsCloseUnauthorized, 'unauthorized')
        return
      }

      const alias = new URL(request?.url ?? 'http://localhost/v1/voltd/ws').searchParams.get('agent')?.trim()
      if (!alias) {
        ws.close(wsCloseUnauthorized, 'missing agent parameter')
        return
      }

      state.userId = user.id
      const live = sessionsPerUser.get(user.id) ?? 0
      if (live >= maxSessions) {
        ws.close(wsCloseTooManySessions, 'too many concurrent agent sessions')
        return
      }
      sessionsPerUser.set(user.id, live + 1)
      state.countedUserId = user.id

      const token = await options.service.mint({ userId: user.id, groups: readPrincipalGroups(user) })
      if (state.closed) return

      const target = new URL(options.gatewayUrl)
      target.searchParams.set('agent', alias)
      state.targetUrl = target.toString()

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
      // The client may have hung up between the check above and here; closing the
      // socket we just created is the only way it gets cleaned up, because the
      // close handler already ran and saw no upstream.
      if (state.closed) {
        safeClose(upstream)
        return
      }

      // A gateway that accepts the TCP connection but never completes the
      // handshake would otherwise hold this connection, and its queue, open
      // indefinitely.
      state.connectTimer = setTimeout(() => {
        if (state.ready) return
        safeClose(upstream)
        safeClose(ws, wsCloseCodes.internalError, 'gateway did not complete the handshake')
      }, connectTimeoutMs)
      const clearConnectTimer = () => {
        if (state.connectTimer) clearTimeout(state.connectTimer)
        state.connectTimer = null
      }

      upstream.onopen = () => {
        clearConnectTimer()
        state.ready = true
        for (const frame of state.pending) upstream.send(frame)
        state.pending = []
        state.pendingBytes = 0
      }
      upstream.onmessage = (event: MessageEvent) => ws.send(event.data)
      upstream.onerror = () => {
        clearConnectTimer()
        safeClose(ws, wsCloseCodes.internalError, 'gateway socket failed')
      }
      // Propagate the gateway's own code where it is a valid one to forward, so a
      // 401 on upgrade (no agents for this principal) stays distinguishable from
      // our own failures.
      upstream.onclose = (event: CloseEvent) => {
        clearConnectTimer()
        safeClose(ws, event.code >= 1000 && event.code <= 4999 ? event.code : wsCloseCodes.internalError, event.reason)
      }
    },

    message(ws: RelayDownstream, message: unknown) {
      const state = states.get(ws)
      if (!state || state.closed) return
      const frame = message as Frame
      if (state.ready && state.upstream) {
        state.upstream.send(frame)
        // Forwarding is not free: a gateway slower than the client turns the
        // upstream socket's own buffer into an unbounded queue, which the
        // pre-connect budget above does nothing about. Hold it to the same cap.
        if (state.upstream.bufferedAmount > queueBytes) {
          safeClose(ws, wsCloseCodes.queueOverflow, 'gateway backpressure')
        }
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

    close(ws: RelayDownstream, code?: number) {
      const state = states.get(ws)
      if (!state) return
      // Set before deleting: `open` may still be mid-await and holds its own
      // reference to this object, which is how it learns not to leave a gateway
      // socket behind.
      state.closed = true
      if (state.connectTimer) clearTimeout(state.connectTimer)
      state.connectTimer = null
      state.pending = []
      state.pendingBytes = 0
      if (state.upstream) safeClose(state.upstream)
      release(state)
      states.delete(ws)

      // One event per relayed connection, through the same recorder the universal
      // proxy uses, so the relay is not the one hop with no telemetry.
      observability.proxyWsRelay({
        method: 'GET',
        duration_ms: Date.now() - state.openedAt,
        user_id: state.userId,
        request_id: '',
        target_url: state.targetUrl,
        close_code: code ?? 1006,
        error_type: code === undefined ? undefined : classifyWsCloseCode(code),
      })
    },
  }
}
