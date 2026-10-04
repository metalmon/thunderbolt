/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Contributes a voltd gateway's agents to `GET /agents`, so an authenticated user
 * gets exactly the agents their groups entitle them to with no pairing code and
 * no per-user configuration.
 *
 * The descriptors are `managed-acp` pointing at our own relay
 * (`/v1/voltd/ws?agent=<alias>`), the same shape Haystack uses. That is what lets
 * the client stay untouched: `agents_system` only stores `managed-acp`, and
 * `openTransport` already dials a backend-hosted URL with the user's session
 * bearer. The gateway's own token never leaves this process.
 *
 * Authorization is not duplicated here. We present the user's minted token and
 * report whatever roster voltd returns; `profile_map` in the gateway's config
 * remains the only place access is decided, and `session/new` is still refused
 * with `agent_not_permitted` if a client asks for an alias it should not have.
 *
 * Registered as `required`, so a gateway outage fails the discovery response
 * instead of returning a 200 that the client would read as "these agents are
 * gone" and delete (`refreshSystemAgents`).
 */

import { buildWebSocketUrl, type AgentProvider } from '@/agents/discovery'
import type { Settings } from '@/config/settings'
import type { RemoteAgentDescriptor } from '@shared/acp-types'
import type { User } from '@shared/types/auth'
import { fetchVoltdRoster, type VoltdRosterAgent } from './roster'
import { isSecureGatewayUrl, readPrincipalGroups, type VoltdTokenService } from './token'

/** Prefix for descriptor ids, keeping aliases from colliding with other providers. */
const agentIdPrefix = 'voltd-'

export type CreateVoltdAgentProviderOptions = {
  service: VoltdTokenService
  /** Gateway ACP endpoint, from `VOLTD_URL`. */
  gatewayUrl: string
  /** Resolves the caller from the request — the route already authenticated them. */
  resolveUser: (request: Request) => Promise<User | null>
  /** Test seams. */
  fetchRoster?: typeof fetchVoltdRoster
  timeoutMs?: number
}

/**
 * Build the provider. Returns null when the deployment names no gateway, so the
 * registry stays untouched on installations that do not use one.
 *
 * @param options - token service, gateway URL, and seams
 */
export const createVoltdAgentProvider = (options: CreateVoltdAgentProviderOptions): AgentProvider | null => {
  if (!options.gatewayUrl.trim()) return null
  // Refuse rather than dial: a `ws://` gateway outside loopback would put the
  // minted access token on the wire in clear text. Disabling the feature is the
  // fail-closed choice — the operator sees no agents and fixes the URL.
  if (!isSecureGatewayUrl(options.gatewayUrl)) return null
  const fetchRoster = options.fetchRoster ?? fetchVoltdRoster

  return {
    id: 'voltd',
    required: true,
    list: async (request: Request, _settings: Settings): Promise<RemoteAgentDescriptor[]> => {
      const user = await options.resolveUser(request)
      // No identity means no groups to map to a profile; contribute nothing
      // rather than asking the gateway on behalf of nobody. Not an error: the
      // route itself has already decided who may see system agents.
      if (!user || user.isAnonymous) return []

      const token = await options.service.mint({ userId: user.id, groups: readPrincipalGroups(user) })
      const roster = await fetchRoster({
        gatewayUrl: options.gatewayUrl,
        token,
        timeoutMs: options.timeoutMs,
      })
      return roster.map((agent) => toDescriptor(agent, request))
    },
  }
}

/**
 * Map a roster entry to a descriptor whose URL points at our relay rather than at
 * the gateway. The URL comes from `buildWebSocketUrl`, which honours
 * `x-forwarded-proto`/`x-forwarded-host` — without that, a deployment behind a
 * TLS terminator (where the backend itself speaks plain http) would advertise
 * `ws://` and the client would carry its session bearer in clear text.
 *
 * @param agent - roster entry
 * @param request - the discovery request, for host derivation
 */
const toDescriptor = (agent: VoltdRosterAgent, request: Request): RemoteAgentDescriptor => ({
  id: `${agentIdPrefix}${agent.alias}`,
  name: agent.displayName ?? agent.alias,
  type: 'managed-acp',
  transport: 'websocket',
  url: buildWebSocketUrl(request, `voltd/ws?agent=${encodeURIComponent(agent.alias)}`),
  description: null,
  icon: null,
  isSystem: 1,
})
