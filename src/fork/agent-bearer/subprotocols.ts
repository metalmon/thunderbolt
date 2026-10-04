/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork helper: build the `Sec-WebSocket-Protocol` list that carries an agent
 * bearer token to a zeroclaw gateway, plus the browser `WebSocket` factory that
 * uses it.
 *
 * The wire constants and the list builder moved to `shared/zeroclaw-acp.ts` when
 * the backend started speaking the same protocol (its voltd roster probe and ACP
 * relay). They are re-exported here so existing frontend import sites and tests
 * keep working; only the factory below is frontend-specific, because it needs the
 * `WebSocketLike` shape.
 */

import type { WebSocketLike } from '@/acp/transports/websocket'
import { buildAgentSubprotocols } from '@shared/zeroclaw-acp'

export {
  agentBearerSubprotocolPrefix,
  buildAgentSubprotocols,
  buildPairingSubprotocols,
  voltCarrierSubprotocol,
  zeroclawCarrierSubprotocol,
} from '@shared/zeroclaw-acp'

/**
 * Build a `WebSocketFactory` that opens with the bearer subprotocols for
 * `token`, or `undefined` when there's no usable token — callers fall back to
 * their own default (tokenless) construction in that case. Keeps the
 * `new WebSocket(...)` construction itself out of the upstream MPL probe file
 * per the fork's thin-hook rule.
 */
export const buildAgentWebSocketFactory = (
  token: string | null | undefined,
): ((url: string) => WebSocketLike) | undefined => {
  const protocols = buildAgentSubprotocols(token)
  if (!protocols) {
    return undefined
  }
  return (url) => new WebSocket(url, protocols) as unknown as WebSocketLike
}
