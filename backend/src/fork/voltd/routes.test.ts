/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Route-level tests for the voltd issuer surface. Following
 * backend/docs/testing.md: DI for the `Auth` mock, no module mocks, no DB (these
 * routes touch neither).
 */

import type { Auth } from '@/auth/elysia-plugin'
import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { decodeProtectedHeader, exportPKCS8, exportSPKI, generateKeyPair, jwtVerify } from 'jose'
import { createVoltdRoutes } from './routes'
import { voltdMaxTokenTtlSeconds, type VoltdTokenConfig } from './token'

const keys = await generateKeyPair('ES256', { extractable: true })
const issuer = 'https://backend.volt.example/v1'

const config: VoltdTokenConfig = {
  issuer,
  audience: 'volt',
  privateKeyPem: await exportPKCS8(keys.privateKey),
  publicKeyPem: await exportSPKI(keys.publicKey),
  ttlSeconds: voltdMaxTokenTtlSeconds,
}

type TestUser = { id: string; isAnonymous: boolean; groups?: unknown }

const buildAuth = (user: TestUser | null): Auth =>
  ({
    api: { getSession: () => Promise.resolve(user ? { user, session: {} } : null) },
  }) as unknown as Auth

const buildApp = async (user: TestUser | null, overrides: Partial<VoltdTokenConfig> | null = {}): Promise<Elysia> => {
  const routes = await createVoltdRoutes({
    auth: buildAuth(user),
    config: overrides === null ? null : { ...config, ...overrides },
  })
  return new Elysia().use(routes) as unknown as Elysia
}

const get = (app: Elysia, path: string) => app.handle(new Request(`https://backend.volt.example${path}`))

describe('voltd issuer routes', () => {
  it('publishes a discovery document whose issuer matches the tokens it signs', async () => {
    const app = await buildApp({ id: 'user-1', isAnonymous: false })
    const body = await (await get(app, '/.well-known/openid-configuration')).json()
    expect(body).toEqual({ issuer, jwks_uri: `${issuer}/voltd/jwks` })
  })

  it('serves a JWKS without private key material', async () => {
    const app = await buildApp({ id: 'user-1', isAnonymous: false })
    const body = await (await get(app, '/voltd/jwks')).json()
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].d).toBeUndefined()
    expect(body.keys[0].kid).toBeTruthy()
  })

  it('lets the gateway re-read discovery and JWKS after a key rotation', async () => {
    const app = await buildApp({ id: 'user-1', isAnonymous: false })
    for (const path of ['/.well-known/openid-configuration', '/voltd/jwks']) {
      const response = await get(app, path)
      expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    }
  })

  it('mints a token for an authenticated user, carrying their groups', async () => {
    const app = await buildApp({ id: 'user-1', isAnonymous: false, groups: ['volt-crm'] })
    const response = await get(app, '/voltd/token')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.expiresIn).toBe(voltdMaxTokenTtlSeconds)

    const { payload } = await jwtVerify(body.token, keys.publicKey, { issuer, audience: 'volt' })
    expect(payload.sub).toBe('user-1')
    expect(payload.groups).toEqual(['volt-crm'])
    expect(decodeProtectedHeader(body.token).typ).toBe('at+jwt')
  })

  it('never caches a minted token', async () => {
    const app = await buildApp({ id: 'user-1', isAnonymous: false })
    expect((await get(app, '/voltd/token')).headers.get('cache-control')).toBe('no-store')
  })

  it('refuses an unauthenticated caller', async () => {
    const app = await buildApp(null)
    expect((await get(app, '/voltd/token')).status).toBe(401)
  })

  it('refuses an anonymous session — it has no identity to map to a profile', async () => {
    const app = await buildApp({ id: 'anon-1', isAnonymous: true })
    const response = await get(app, '/voltd/token')
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ANONYMOUS_VOLTD_TOKEN_FORBIDDEN' })
  })

  it('mints an empty groups claim for a user the IdP has not provisioned yet', async () => {
    const app = await buildApp({ id: 'user-1', isAnonymous: false })
    const { token } = await (await get(app, '/voltd/token')).json()
    const { payload } = await jwtVerify(token, keys.publicKey)
    expect(payload.groups).toEqual([])
  })

  it('exposes no routes at all when the deployment has no signing key', async () => {
    const app = await buildApp({ id: 'user-1', isAnonymous: false }, null)
    for (const path of ['/.well-known/openid-configuration', '/voltd/jwks', '/voltd/token']) {
      expect((await get(app, path)).status).toBe(404)
    }
  })
})
