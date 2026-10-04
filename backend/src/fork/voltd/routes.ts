/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The issuer surface a voltd (ZeroClaw) gateway needs in order to accept
 * Thunderbolt users without pairing codes:
 *
 * - `GET /.well-known/openid-configuration` — discovery, read by voltd
 * - `GET /voltd/jwks` — our public key, read by voltd
 * - `WS  /voltd/ws?agent=<alias>` — the ACP relay (see `relay.ts`)
 *
 * It also registers the agent provider, so the gateway's agents appear in
 * `GET /agents` — the same construction-time side effect `createHaystackRoutes`
 * uses for its own provider.
 *
 * There is deliberately no `/voltd/token` route. The contract defines one for a
 * client that dials the gateway itself, but here the backend mints and consumes
 * the token server-side, so exposing it would be surface nothing uses.
 *
 * Mounted on the app root, which carries the `/v1` prefix, so the issuer is
 * `${BETTER_AUTH_URL}/v1` — the same origin and path the client already uses as
 * `cloudUrl`. Keeping them identical matters: voltd compares `iss` to its own
 * configured issuer byte for byte.
 *
 * Discovery and JWKS are machine-to-machine and arrive without `X-App-Version`, so
 * their prefixes must stay in `appVersionExemptPrefixes` or they 426 the moment
 * a deployment sets `MIN_APP_VERSION`.
 *
 * Inert until configured: with no signing key the plugin exposes no routes at
 * all, so this can ship ahead of any deployment that uses it.
 */

import { registerAgentProvider } from '@/agents/discovery'
import type { Auth } from '@/auth/elysia-plugin'
import { safeErrorHandler } from '@/middleware/error-handling'
import type { User } from '@shared/types/auth'
import { Elysia, type AnyElysia } from 'elysia'
import { createVoltdAgentProvider } from './provider'
import { createVoltdRelayRoutes } from './relay'
import { createVoltdTokenService, readVoltdTokenConfig, type VoltdTokenConfig, type VoltdTokenService } from './token'

export type CreateVoltdRoutesOptions = {
  auth: Auth
  /** Test seam — production reads the environment. */
  config?: VoltdTokenConfig | null
  /** Test seam — production builds the service from `config`. */
  service?: VoltdTokenService
  /** Gateway ACP endpoint. Production reads `VOLTD_URL`. */
  gatewayUrl?: string
  /** Test seam for the relay's upstream socket. */
  wsFactory?: (url: string, protocols: string[]) => WebSocket
}

/**
 * Builds the voltd routes and registers the agent provider, or a plugin with no
 * routes when the deployment has no signing key configured.
 *
 * @param options - auth plugin, gateway URL, plus test seams
 */
export const createVoltdRoutes = async (options: CreateVoltdRoutesOptions): Promise<AnyElysia> => {
  const base = new Elysia({ name: 'voltd-routes' }).onError(safeErrorHandler)
  const config = options.config === undefined ? readVoltdTokenConfig() : options.config
  if (!config && !options.service) return base

  const service = options.service ?? (await createVoltdTokenService(config as VoltdTokenConfig))
  const gatewayUrl = options.gatewayUrl ?? process.env.VOLTD_URL ?? ''

  // Construction-time side effect, mirroring createHaystackRoutes. Null when no
  // usable gateway is configured, so the registry is untouched on deployments
  // that only want the issuer surface.
  const provider = createVoltdAgentProvider({
    service,
    gatewayUrl,
    resolveUser: async (request) => {
      const session = await options.auth.api.getSession({ headers: request.headers })
      return (session?.user as User | undefined) ?? null
    },
  })
  if (provider) registerAgentProvider(provider)

  return base
    .get('/.well-known/openid-configuration', ({ set }) => {
      // Short, not immutable: a key rotation must reach the gateway without an
      // operator having to restart it.
      set.headers['cache-control'] = 'public, max-age=300'
      return { issuer: service.issuer, jwks_uri: `${service.issuer}/voltd/jwks` }
    })
    .get('/voltd/jwks', ({ set }) => {
      set.headers['cache-control'] = 'public, max-age=300'
      return service.jwks
    })
    .use(createVoltdRelayRoutes({ auth: options.auth, service, gatewayUrl, wsFactory: options.wsFactory }))
}
