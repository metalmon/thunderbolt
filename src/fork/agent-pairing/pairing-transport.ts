/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork helper: a tokenless, proxy-aware WebSocket factory for the pre-auth
 * pairing socket. It mirrors `resolveWebSocketFactory`'s standalone-vs-proxy
 * branch (`src/acp/transports/index.ts`) so pairing takes the exact same
 * network path as a normal connect — but offers `buildPairingSubprotocols()`
 * and carries NO bearer (the socket is pre-auth). Composed purely from EXPORTED
 * helpers so the upstream transports file stays untouched (fork thin-hook rule).
 */

import { isStandaloneTransport } from '@/acp/transports'
import type { WebSocketLike } from '@/acp/transports/websocket'
import { buildPairingSubprotocols } from '@/fork/agent-bearer/subprotocols'
import { createProxyWebSocket } from '@/lib/proxy-fetch'
import { useLocalSettingsStore } from '@/stores/local-settings-store'

/** DI seams — production omits them and the underlying helpers read the
 *  platform / localStorage / auth globals. Tests pass explicit values. */
export type PairingTransportInputs = {
  isStandalone?: () => boolean
  readProxyEnabled?: () => string | null
  getAuthToken?: () => string | null
}

/**
 * Build the WebSocket factory for the transient pairing socket. Native on Tauri
 * Standalone; proxied otherwise (Web always, Tauri with the proxy toggle on) —
 * identical routing to a normal remote-acp connect, minus the credential.
 */
export const resolvePairingWebSocketFactory = (
  inputs: PairingTransportInputs = {},
): ((url: string) => WebSocketLike) => {
  const protocols = buildPairingSubprotocols()
  if (isStandaloneTransport(inputs.isStandalone, inputs.readProxyEnabled)) {
    return (url) => new WebSocket(url, protocols) as unknown as WebSocketLike
  }
  const proxyWs = createProxyWebSocket({
    cloudUrl: useLocalSettingsStore.getState().cloudUrl,
    isStandalone: inputs.isStandalone,
    getAuthToken: inputs.getAuthToken,
  })
  return (url) => proxyWs(url, protocols) as unknown as WebSocketLike
}
