/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Asks a voltd gateway which agents the bearer of a token may use.
 *
 * voltd answers this in the ACP `initialize` result, under
 * `_meta.zeroclaw.agents` — so one request/response is the whole exchange. We
 * open the socket, send one frame, read one frame and close; no ACP session is
 * ever started here, which is why this does not build a `ClientSideConnection`
 * from the SDK (that wants a duplex stream and a full client implementation for
 * a handshake we discard immediately). `PROTOCOL_VERSION` still comes from the
 * SDK so the number cannot drift from the one the frontend negotiates.
 */

import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { buildAgentSubprotocols } from '@shared/zeroclaw-acp'

/** One entry of voltd's roster, as it appears in `_meta.zeroclaw.agents`. */
export type VoltdRosterAgent = {
  alias: string
  displayName: string | null
  isDefault: boolean
}

export type FetchVoltdRosterOptions = {
  /** Gateway ACP endpoint, e.g. `wss://gateway.internal:8443/acp`. */
  gatewayUrl: string
  /** Access token minted for the user whose roster this is. */
  token: string
  timeoutMs?: number
  /** Test seam — production uses the global `WebSocket`. */
  webSocketFactory?: (url: string, protocols: string[]) => WebSocket
}

const defaultTimeoutMs = 10_000

/**
 * Open a short-lived socket to the gateway and return the roster for `token`.
 *
 * Rejects on timeout, transport failure, or a JSON-RPC error — callers must not
 * translate that into an empty roster, because an empty list and "we could not
 * ask" mean opposite things to the client (see `required` on `AgentProvider`).
 *
 * @param options - gateway URL, token, and test seams
 */
export const fetchVoltdRoster = async (options: FetchVoltdRosterOptions): Promise<VoltdRosterAgent[]> => {
  const protocols = buildAgentSubprotocols(options.token)
  if (!protocols) throw new Error('voltd roster requires a token')

  const factory = options.webSocketFactory ?? ((url, p) => new WebSocket(url, p))
  const socket = factory(options.gatewayUrl, protocols)

  return new Promise<VoltdRosterAgent[]>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs

    let done = false
    const settle = (error: Error | null, agents?: VoltdRosterAgent[]) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // Already closing or closed; nothing to do.
      }
      if (error) reject(error)
      else resolve(agents ?? [])
    }

    // Our own close() in settle() fires onclose, so the guard above is what keeps
    // the success path from being overwritten by the close handler's rejection.
    const timer = setTimeout(() => settle(new Error(`voltd roster timed out after ${timeoutMs}ms`)), timeoutMs)

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} },
        }),
      )
    }

    socket.onmessage = (event: MessageEvent) => {
      const frame = parseFrame(event.data)
      // The gateway may emit notifications before the reply; ignore anything
      // that is not the answer to our one request.
      if (!frame || frame.id !== 1) return
      if (frame.error) {
        settle(new Error(`voltd rejected initialize: ${frame.error.message ?? 'unknown error'}`))
        return
      }
      settle(null, readRoster(frame.result))
    }

    socket.onerror = () => settle(new Error('voltd roster socket failed'))
    socket.onclose = () => settle(new Error('voltd closed the socket before answering initialize'))
  })
}

type JsonRpcFrame = {
  id?: unknown
  result?: unknown
  error?: { message?: string }
}

const parseFrame = (data: unknown): JsonRpcFrame | null => {
  if (typeof data !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(data)
    return parsed && typeof parsed === 'object' ? (parsed as JsonRpcFrame) : null
  } catch {
    return null
  }
}

/**
 * Pull the roster out of an `initialize` result, tolerating a gateway that omits
 * `_meta` entirely (an older build, or one with no agent catalogue): that is an
 * empty roster, not a malformed answer.
 *
 * @param result - the `initialize` result object
 */
const readRoster = (result: unknown): VoltdRosterAgent[] => {
  const meta = (result as { _meta?: { zeroclaw?: { agents?: unknown } } } | null | undefined)?._meta
  const agents = meta?.zeroclaw?.agents
  if (!Array.isArray(agents)) return []

  return agents.flatMap((entry): VoltdRosterAgent[] => {
    const alias = (entry as { alias?: unknown } | null)?.alias
    if (typeof alias !== 'string' || !alias.trim()) return []
    const displayName = (entry as { display_name?: unknown }).display_name
    return [
      {
        alias,
        displayName: typeof displayName === 'string' && displayName.trim() ? displayName : null,
        isDefault: (entry as { default?: unknown }).default === true,
      },
    ]
  })
}
