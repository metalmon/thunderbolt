/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Route-level tests for the voltd issuer surface. Following
 * backend/docs/testing.md: DI for the `Auth` mock, no module mocks, no DB (these
 * routes touch neither).
 */

import type { Auth } from '@/auth/elysia-plugin'
import { getRegisteredProviders, resetAgentProvidersForTesting } from '@/agents/discovery'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose'
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

const buildAuth = (): Auth =>
  ({
    api: { getSession: () => Promise.resolve({ user: { id: 'user-1', isAnonymous: false }, session: {} }) },
  }) as unknown as Auth

const buildApp = async (overrides: Partial<VoltdTokenConfig> | null = {}, gatewayUrl = ''): Promise<Elysia> => {
  const routes = await createVoltdRoutes({
    auth: buildAuth(),
    config: overrides === null ? null : { ...config, ...overrides },
    gatewayUrl,
  })
  return new Elysia().use(routes) as unknown as Elysia
}

const get = (app: Elysia, path: string) => app.handle(new Request(`https://backend.volt.example${path}`))

describe('voltd issuer routes', () => {
  beforeEach(() => resetAgentProvidersForTesting())
  afterEach(() => resetAgentProvidersForTesting())

  it('publishes a discovery document whose issuer matches the tokens it signs', async () => {
    const body = await (await get(await buildApp(), '/.well-known/openid-configuration')).json()
    expect(body).toEqual({ issuer, jwks_uri: `${issuer}/voltd/jwks` })
  })

  it('serves a JWKS without private key material', async () => {
    const body = await (await get(await buildApp(), '/voltd/jwks')).json()
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0].d).toBeUndefined()
    expect(body.keys[0].kid).toBeTruthy()
  })

  it('lets the gateway re-read discovery and JWKS after a key rotation', async () => {
    const app = await buildApp()
    for (const path of ['/.well-known/openid-configuration', '/voltd/jwks']) {
      expect((await get(app, path)).headers.get('cache-control')).toBe('public, max-age=300')
    }
  })

  // The backend mints and consumes the gateway token itself, so a client-facing
  // mint route would be surface nothing uses.
  it('exposes no token-minting route', async () => {
    expect((await get(await buildApp(), '/voltd/token')).status).toBe(404)
  })

  it('exposes no routes at all when the deployment has no signing key', async () => {
    const app = await buildApp(null)
    for (const path of ['/.well-known/openid-configuration', '/voltd/jwks']) {
      expect((await get(app, path)).status).toBe(404)
    }
  })

  it('registers the agent provider when a gateway is configured', async () => {
    await buildApp({}, 'wss://gateway.internal:8443/acp')
    expect(getRegisteredProviders().map((p) => p.id)).toContain('voltd')
  })

  it('registers no provider without a gateway', async () => {
    await buildApp({}, '')
    expect(getRegisteredProviders()).toHaveLength(0)
  })

  it('registers no provider for a cleartext gateway outside loopback', async () => {
    await buildApp({}, 'ws://gateway.internal:8443/acp')
    expect(getRegisteredProviders()).toHaveLength(0)
  })
})
