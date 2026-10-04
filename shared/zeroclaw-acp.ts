/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Wire contract for talking ACP to a zeroclaw/voltd gateway, shared because both
 * ends now speak it: the frontend transports (`src/fork/agent-bearer/subprotocols.ts`,
 * which re-exports these) and the backend's roster probe and relay
 * (`backend/src/fork/voltd/**`). Drift between two copies would be silent, which
 * is the same reason `shared/ws-bearer.ts` exists.
 *
 * Deliberately distinct from `shared/ws-bearer.ts` — that one carries Thunderbolt
 * cloud auth as `thunderbolt.bearer.<base64url>`. zeroclaw's `extract_ws_token`
 * reads a bare `bearer.<token>` with a plain `strip_prefix` and no decode. Do not
 * unify them.
 */

/** Preferred carrier (zeroclaw's `/acp` accept-both prefers it). */
export const voltCarrierSubprotocol = 'volt.acp.v1'

/** Legacy carrier the zeroclaw `/acp` endpoint echoes for older clients
 *  (`ACP_WS_PROTOCOLS` in acp.rs). Kept in the offer for backward compat. */
export const zeroclawCarrierSubprotocol = 'zeroclaw.acp.v1'

/** zeroclaw bearer subprotocol prefix. Bare `bearer.`, NOT `thunderbolt.bearer.`. */
export const agentBearerSubprotocolPrefix = 'bearer.'

/**
 * Build the subprotocol list for a bearer token (a user-configured `zc_` token or
 * a minted OIDC access token — zeroclaw accepts either here).
 *
 * Both carriers are offered, `volt.acp.v1` first, so the server selects and echoes
 * one entry: RFC 6455 clients (WebView2) reject a handshake that offered
 * subprotocols and got none back.
 *
 * Returns `undefined` when no usable token is present so callers fall back to
 * their exact current (tokenless) WebSocket construction.
 *
 * @param token - bearer token, or null/undefined/blank for none
 */
export const buildAgentSubprotocols = (token: string | null | undefined): string[] | undefined => {
  const trimmed = token?.trim()
  if (!trimmed) {
    return undefined
  }
  return [voltCarrierSubprotocol, zeroclawCarrierSubprotocol, `${agentBearerSubprotocolPrefix}${trimmed}`]
}

/** Carrier-only list (no bearer) for a pre-auth socket. Both carriers, volt first. */
export const buildPairingSubprotocols = (): string[] => [voltCarrierSubprotocol, zeroclawCarrierSubprotocol]
