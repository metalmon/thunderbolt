/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The issuer surface a voltd (ZeroClaw) gateway needs in order to accept
 * Thunderbolt users without pairing codes:
 *
 * - `GET /.well-known/openid-configuration` — discovery, read by voltd
 * - `GET /voltd/jwks` — our public key, read by voltd
 * - `GET /voltd/token` — mints the caller's access token, read by our client
 *
 * Mounted on the app root, which carries the `/v1` prefix, so the issuer is
 * `${BETTER_AUTH_URL}/v1` — the same origin and path the client already uses as
 * `cloudUrl`. Keeping them identical matters: voltd compares `iss` to its own
 * configured issuer byte for byte.
 *
 * The first two are machine-to-machine and arrive without `X-App-Version`, so
 * their prefixes must stay in `appVersionExemptPrefixes` or they 426 the moment
 * a deployment sets `MIN_APP_VERSION`. `/voltd/token` is called by our own
 * client and deliberately stays subject to the gate.
 *
 * Inert until configured: with no signing key the plugin exposes no routes at
 * all, so this can ship ahead of any deployment that uses it.
 */

import { createAuthMacro, type Auth } from '@/auth/elysia-plugin'
import { safeErrorHandler } from '@/middleware/error-handling'
import type { User } from '@shared/types/auth'
import { Elysia, type AnyElysia } from 'elysia'
import {
  createVoltdTokenService,
  readPrincipalGroups,
  readVoltdTokenConfig,
  type VoltdTokenConfig,
  type VoltdTokenService,
} from './token'

export type CreateVoltdRoutesOptions = {
  auth: Auth
  /** Test seam — production reads the environment. */
  config?: VoltdTokenConfig | null
  /** Test seam — production builds the service from `config`. */
  service?: VoltdTokenService
}

/**
 * Builds the voltd issuer routes, or a plugin with no routes when the deployment
 * has no signing key configured.
 *
 * @param options - auth plugin plus test seams
 */
export const createVoltdRoutes = async (options: CreateVoltdRoutesOptions): Promise<AnyElysia> => {
  const base = new Elysia({ name: 'voltd-routes' }).onError(safeErrorHandler)
  const config = options.config === undefined ? readVoltdTokenConfig() : options.config
  if (!config && !options.service) return base

  const service = options.service ?? (await createVoltdTokenService(config as VoltdTokenConfig))

  return base
    .use(createAuthMacro(options.auth))
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
    .get(
      '/voltd/token',
      async ({ user, set, status }) => {
        // The macro has already rejected an absent session. Anonymous sessions
        // are refused the same way `GET /agents` refuses them — an anonymous
        // user has no identity to map to a permission profile.
        if ((user as User).isAnonymous) {
          return status(403, { error: 'Forbidden', code: 'ANONYMOUS_VOLTD_TOKEN_FORBIDDEN' })
        }
        set.headers['cache-control'] = 'no-store'
        const token = await service.mint({ userId: user.id, groups: readPrincipalGroups(user) })
        return { token, expiresIn: service.ttlSeconds }
      },
      { auth: true },
    )
}
