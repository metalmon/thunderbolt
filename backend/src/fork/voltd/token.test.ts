/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { decodeProtectedHeader, exportPKCS8, exportSPKI, generateKeyPair, importJWK, jwtVerify } from 'jose'
import {
  createVoltdTokenService,
  isSecureGatewayUrl,
  isValidVoltdIssuer,
  readPrincipalGroups,
  readVoltdTokenConfig,
  resolveVoltdIssuer,
  voltdMaxTokenTtlSeconds,
  type VoltdTokenConfig,
} from './token'

const keys = await generateKeyPair('ES256', { extractable: true })
const privateKeyPem = await exportPKCS8(keys.privateKey)
const publicKeyPem = await exportSPKI(keys.publicKey)

const config = (overrides: Partial<VoltdTokenConfig> = {}): VoltdTokenConfig => ({
  issuer: 'https://backend.volt.example/v1',
  audience: 'volt',
  privateKeyPem,
  publicKeyPem,
  ttlSeconds: voltdMaxTokenTtlSeconds,
  ...overrides,
})

describe('resolveVoltdIssuer', () => {
  it('prefers an explicit override', () => {
    expect(resolveVoltdIssuer('https://issuer.example/v1', 'https://other.example')).toBe('https://issuer.example/v1')
  })

  it('derives the backend public base plus the app prefix', () => {
    expect(resolveVoltdIssuer('', 'https://backend.volt.example')).toBe('https://backend.volt.example/v1')
  })

  it('strips trailing slashes from the derived value', () => {
    expect(resolveVoltdIssuer('', 'https://backend.volt.example///')).toBe('https://backend.volt.example/v1')
  })

  it('returns empty when nothing is configured', () => {
    expect(resolveVoltdIssuer('', '')).toBe('')
  })

  it('refuses an issuer voltd would reject rather than minting against it', () => {
    expect(resolveVoltdIssuer('http://backend.volt.example/v1', '')).toBe('')
    expect(resolveVoltdIssuer('https://backend.volt.example/v1?x=1', '')).toBe('')
  })
})

describe('isValidVoltdIssuer', () => {
  it('accepts https without query, fragment or trailing slash', () => {
    expect(isValidVoltdIssuer('https://backend.volt.example/v1')).toBe(true)
  })

  it.each([
    ['plain http on a public host', 'http://backend.volt.example/v1'],
    ['a query string', 'https://backend.volt.example/v1?a=b'],
    ['a fragment', 'https://backend.volt.example/v1#f'],
    ['embedded credentials', 'https://u:p@backend.volt.example/v1'],
    ['a trailing slash', 'https://backend.volt.example/v1/'],
    ['a non-http scheme', 'wss://backend.volt.example/v1'],
    ['a non-URL', 'backend.volt.example'],
  ])('rejects %s', (_label, issuer) => {
    expect(isValidVoltdIssuer(issuer)).toBe(false)
  })

  it.each(['http://localhost:8000/v1', 'http://127.0.0.1:8000/v1', 'http://api.localhost/v1'])(
    'allows plain http on loopback (%s)',
    (issuer) => {
      expect(isValidVoltdIssuer(issuer)).toBe(true)
    },
  )
})

describe('isSecureGatewayUrl', () => {
  it('accepts wss anywhere', () => {
    expect(isSecureGatewayUrl('wss://gateway.internal:8443/acp')).toBe(true)
  })

  it.each([
    ['loopback by name', 'ws://localhost:8443/acp'],
    ['loopback by address', 'ws://127.0.0.1:8443/acp'],
  ])('allows cleartext on %s', (_label, url) => {
    expect(isSecureGatewayUrl(url)).toBe(true)
  })

  it.each([
    ['a LAN host', 'ws://gateway.internal:8443/acp'],
    ['a public host', 'ws://gateway.example.com/acp'],
    ['embedded credentials', 'wss://u:p@gateway.internal/acp'],
    ['a non-ws scheme', 'https://gateway.internal/acp'],
    ['a non-URL', 'gateway.internal:8443'],
  ])('rejects %s', (_label, url) => {
    expect(isSecureGatewayUrl(url)).toBe(false)
  })
})

describe('readVoltdTokenConfig', () => {
  it('returns null without a key pair, so the routes stay inert', () => {
    expect(readVoltdTokenConfig({ BETTER_AUTH_URL: 'https://backend.volt.example' })).toBeNull()
  })

  it('returns null when the issuer cannot be resolved', () => {
    expect(readVoltdTokenConfig({ VOLTD_JWT_PRIVATE_KEY_PEM: privateKeyPem, VOLTD_JWT_PUBLIC_KEY_PEM: publicKeyPem })).toBeNull()
  })

  it('defaults the audience to volt and the lifetime to the gateway ceiling', () => {
    const resolved = readVoltdTokenConfig({
      BETTER_AUTH_URL: 'https://backend.volt.example',
      VOLTD_JWT_PRIVATE_KEY_PEM: privateKeyPem,
      VOLTD_JWT_PUBLIC_KEY_PEM: publicKeyPem,
    })
    expect(resolved).toMatchObject({
      issuer: 'https://backend.volt.example/v1',
      audience: 'volt',
      ttlSeconds: voltdMaxTokenTtlSeconds,
    })
  })

  // The file form is the one a container can use: a PEM is multi-line so env_file
  // cannot carry it, and a private key in an env var leaks into docker inspect.
  it('reads keys from files when given paths', () => {
    const files: Record<string, string> = { '/keys/priv.pem': privateKeyPem, '/keys/pub.pem': publicKeyPem }
    const resolved = readVoltdTokenConfig(
      {
        BETTER_AUTH_URL: 'https://backend.volt.example',
        VOLTD_JWT_PRIVATE_KEY_FILE: '/keys/priv.pem',
        VOLTD_JWT_PUBLIC_KEY_FILE: '/keys/pub.pem',
      },
      (path) => files[path] ?? (() => { throw new Error('ENOENT') })(),
    )
    expect(resolved?.privateKeyPem).toBe(privateKeyPem)
    expect(resolved?.publicKeyPem).toBe(publicKeyPem)
  })

  it('prefers an inline PEM over a path', () => {
    const resolved = readVoltdTokenConfig(
      {
        BETTER_AUTH_URL: 'https://backend.volt.example',
        VOLTD_JWT_PRIVATE_KEY_PEM: privateKeyPem,
        VOLTD_JWT_PUBLIC_KEY_PEM: publicKeyPem,
        VOLTD_JWT_PRIVATE_KEY_FILE: '/never/read',
      },
      () => {
        throw new Error('should not be read')
      },
    )
    expect(resolved?.privateKeyPem).toBe(privateKeyPem)
  })

  // Inert beats crashing the backend at startup over a typo'd path.
  it('stays inert when a key path cannot be read', () => {
    const resolved = readVoltdTokenConfig(
      {
        BETTER_AUTH_URL: 'https://backend.volt.example',
        VOLTD_JWT_PRIVATE_KEY_FILE: '/missing/priv.pem',
        VOLTD_JWT_PUBLIC_KEY_FILE: '/missing/pub.pem',
      },
      () => {
        throw new Error('ENOENT')
      },
    )
    expect(resolved).toBeNull()
  })

  it('clamps a lifetime above the gateway ceiling instead of minting a token it refuses', () => {
    const resolved = readVoltdTokenConfig({
      BETTER_AUTH_URL: 'https://backend.volt.example',
      VOLTD_JWT_PRIVATE_KEY_PEM: privateKeyPem,
      VOLTD_JWT_PUBLIC_KEY_PEM: publicKeyPem,
      VOLTD_TOKEN_TTL_SECONDS: '3600',
    })
    expect(resolved?.ttlSeconds).toBe(voltdMaxTokenTtlSeconds)
  })
})

describe('createVoltdTokenService', () => {
  it('mints a token carrying every claim the gateway requires', async () => {
    const service = await createVoltdTokenService(config())
    const token = await service.mint({ userId: 'user-1', groups: ['volt-crm'] })

    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer: 'https://backend.volt.example/v1',
      audience: 'volt',
    })
    expect(payload.sub).toBe('user-1')
    expect(payload.client_id).toBe('thunderbolt')
    expect(payload.groups).toEqual(['volt-crm'])
    expect(payload.jti).toBeTruthy()
    expect(payload.iat).toBeDefined()
    // voltd clips anything longer than max_auth_lifetime_secs.
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(voltdMaxTokenTtlSeconds)
  })

  it('sets typ=at+jwt — without it the gateway denies every principal, not just this one', async () => {
    const service = await createVoltdTokenService(config())
    const header = decodeProtectedHeader(await service.mint({ userId: 'user-1', groups: [] }))
    expect(header.typ).toBe('at+jwt')
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(service.jwks.keys[0].kid)
  })

  it('publishes a JWKS whose key verifies the tokens it issues', async () => {
    const service = await createVoltdTokenService(config())
    const token = await service.mint({ userId: 'user-1', groups: [] })
    const published = await importJWK(service.jwks.keys[0], 'ES256')
    await expect(jwtVerify(token, published)).resolves.toBeDefined()
  })

  it('never publishes private key material', async () => {
    const service = await createVoltdTokenService(config())
    expect(service.jwks.keys[0].d).toBeUndefined()
    expect(service.jwks.keys[0].use).toBe('sig')
  })

  it('mints an empty groups array rather than omitting the claim', async () => {
    const service = await createVoltdTokenService(config())
    const { payload } = await jwtVerify(await service.mint({ userId: 'user-1', groups: [] }), keys.publicKey)
    expect(payload.groups).toEqual([])
  })

  it('honours a shortened lifetime', async () => {
    const service = await createVoltdTokenService(config({ ttlSeconds: 120 }))
    const { payload } = await jwtVerify(await service.mint({ userId: 'user-1', groups: [] }), keys.publicKey)
    expect(payload.exp! - payload.iat!).toBe(120)
  })

  it('refuses a blank subject', async () => {
    const service = await createVoltdTokenService(config())
    await expect(service.mint({ userId: '  ', groups: [] })).rejects.toThrow(/non-empty subject/)
  })

  it('issues a distinct jti per token', async () => {
    const service = await createVoltdTokenService(config())
    const [a, b] = await Promise.all([
      service.mint({ userId: 'user-1', groups: [] }),
      service.mint({ userId: 'user-1', groups: [] }),
    ])
    const jti = async (token: string) => (await jwtVerify(token, keys.publicKey)).payload.jti
    expect(await jti(a)).not.toBe(await jti(b))
  })
})

describe('readPrincipalGroups', () => {
  it('reads the additional field when present', () => {
    expect(readPrincipalGroups({ groups: ['volt-admins', 'volt-crm'] })).toEqual(['volt-admins', 'volt-crm'])
  })

  it.each([
    ['a user without the field', {}],
    ['a null user', null],
    ['a non-array value', { groups: 'volt-admins' }],
  ])('returns an empty list for %s', (_label, user) => {
    expect(readPrincipalGroups(user)).toEqual([])
  })

  it('drops entries the gateway could not match', () => {
    expect(readPrincipalGroups({ groups: ['volt-crm', '', '  ', 7, null] })).toEqual(['volt-crm'])
  })
})

describe('identity claims for the gateway user list', () => {
  const verify = async (token: string) => {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer: 'https://backend.volt.example/v1',
      audience: 'volt',
    })
    return payload
  }

  it('carries the address so a JWT sign-in is a person on the gateway, not an id', async () => {
    const service = await createVoltdTokenService(config())
    const token = await service.mint({ userId: 'user-1', groups: ['volt-avk'], email: 'avk@volt.local' })

    const payload = await verify(token)
    expect(payload.email).toBe('avk@volt.local')
  })

  it('never carries a display name — the account holder can set that to anything', async () => {
    const service = await createVoltdTokenService(config())
    // Even if a caller passes one, nothing in the principal shape accepts it, and
    // the minted token must not grow one by accident: the gateway shows it beside
    // groups that ARE authoritative, so a self-chosen "Его величество" would read
    // as if the IdP had said it.
    const token = await service.mint({ userId: 'user-2', groups: ['volt-kb'], email: 'kb@volt.local' })

    const payload = await verify(token)
    expect('name' in payload).toBe(false)
    expect('preferred_username' in payload).toBe(false)
  })

  it('omits the address when absent rather than sending a blank', async () => {
    const service = await createVoltdTokenService(config())
    const token = await service.mint({ userId: 'user-3', groups: [], email: '   ' })

    const payload = await verify(token)
    expect('email' in payload).toBe(false)
    // The half the gateway actually verifies is untouched by the optional one.
    expect(payload.client_id).toBe('thunderbolt')
    expect(payload.aud).toBe('volt')
  })
})
