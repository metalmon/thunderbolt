/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork helper: build the `Sec-WebSocket-Protocol` list that carries a
 * user-configured agent bearer token to a zeroclaw gateway.
 *
 * zeroclaw's `extract_ws_token` reads `bearer.<token>` (bare `bearer.` prefix,
 * plain `strip_prefix`, no decode). We also offer the ACP endpoint's carrier
 * subprotocols so the server selects and echoes one entry — RFC 6455 clients
 * (WebView2) reject a handshake that offered subprotocols but got none back.
 * Both carriers are offered, `volt.acp.v1` first: zeroclaw's `/acp` handler
 * accepts-both (`ACP_WS_PROTOCOLS` in `acp.rs`) and prefers `volt.acp.v1`, but
 * echoes `zeroclaw.acp.v1` verbatim to an older client that only offered that —
 * so offering both stays backward-safe. This is deliberately distinct from
 * `thunderbolt.bearer.` (Thunderbolt cloud auth) — do not unify them.
 */

import type { WebSocketLike } from '@/acp/transports/websocket'

/** Preferred carrier (zeroclaw's `/acp` accept-both prefers it). */
export const voltCarrierSubprotocol = 'volt.acp.v1'

/** Legacy carrier the zeroclaw `/acp` endpoint echoes for older clients
 *  (`ACP_WS_PROTOCOLS` in acp.rs). Kept in the offer for backward compat. */
export const zeroclawCarrierSubprotocol = 'zeroclaw.acp.v1'

/** zeroclaw bearer subprotocol prefix. Bare `bearer.`, NOT `thunderbolt.bearer.`. */
export const agentBearerSubprotocolPrefix = 'bearer.'

/**
 * Build the subprotocol list for a custom agent's bearer token.
 * Returns `undefined` when no usable token is present so callers fall back to
 * the exact current (tokenless) WebSocket construction.
 */
export const buildAgentSubprotocols = (token: string | null | undefined): string[] | undefined => {
  const trimmed = token?.trim()
  if (!trimmed) {
    return undefined
  }
  return [voltCarrierSubprotocol, zeroclawCarrierSubprotocol, `${agentBearerSubprotocolPrefix}${trimmed}`]
}

/** Carrier-only list (no bearer) for the pre-auth pairing socket. Both carriers,
 *  volt first — mirrors `buildAgentSubprotocols` minus the credential. */
export const buildPairingSubprotocols = (): string[] => [voltCarrierSubprotocol, zeroclawCarrierSubprotocol]

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
