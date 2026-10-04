/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Mints the access tokens a voltd gateway accepts in JWKS mode, so an
 * authenticated Thunderbolt user reaches their agents without a pairing code.
 *
 * The contract is voltd's, not ours, and its validator is fail-closed — see
 * `zeroclaw-integration/2026-10-01-oidc-better-auth-contract.md`. Three of its
 * requirements are easy to get wrong and silent when wrong:
 *
 * - the header MUST carry `typ: 'at+jwt'` (RFC 9068). voltd runs with
 *   `require_at_jwt = true`, and without it the gateway declares the whole auth
 *   configuration invalid and denies everyone — not just this token.
 * - `alg` must be ES256 or RS256. EdDSA is rejected (`unsupported JWT alg`).
 * - `iss` must equal the gateway's configured issuer byte for byte, and must be
 *   https for anything but a loopback host.
 *
 * Better Auth's `jwt` plugin cannot produce this: it hardcodes the header to
 * `{alg, kid}` and offers no way to set `typ`. Hence a small service of our own
 * over `jose`, which the backend already depends on.
 */

import { readFileSync } from 'node:fs'
import { SignJWT, calculateJwkThumbprint, exportJWK, importPKCS8, importSPKI, type JWK } from 'jose'

/** The only signing algorithm this service issues. RS256 would also satisfy
 *  voltd; ES256 is chosen for the smaller key and token. */
export const voltdSigningAlg = 'ES256'

/** `client_id` claim value. Must appear in voltd's `interactive_clients`. */
export const voltdClientId = 'thunderbolt'

/** voltd's own ceiling (`max_auth_lifetime_secs = 900`). A token asking for more
 *  is refused, so this is a hard clamp rather than a default. */
export const voltdMaxTokenTtlSeconds = 900

const minTokenTtlSeconds = 60

export type VoltdPrincipal = {
  /** Stable, non-empty — becomes `sub`. */
  userId: string
  /** Group names as the IdP spells them; voltd maps them to permission profiles
   *  via `profile_map`. An empty array is valid here and means "no agents",
   *  which voltd answers with a 401 on upgrade. */
  groups: string[]
}

export type VoltdTokenService = {
  issuer: string
  audience: string
  ttlSeconds: number
  /** Public JWKS document, served so voltd can verify our signatures. */
  jwks: { keys: JWK[] }
  mint: (principal: VoltdPrincipal) => Promise<string>
}

export type VoltdTokenConfig = {
  issuer: string
  audience: string
  privateKeyPem: string
  publicKeyPem: string
  ttlSeconds: number
}

/**
 * Reads the service configuration from the environment, mirroring how the other
 * fork backend modules handle their own config (see `fork/openrouter/routes.ts`)
 * rather than extending the upstream settings schema.
 *
 * Keys come from either `VOLTD_JWT_{PRIVATE,PUBLIC}_KEY_PEM` (inline) or
 * `..._FILE` (a path). Prefer the file form in a container: a PEM is multi-line so
 * `env_file` cannot carry it, and a private key in an environment variable leaks
 * into `docker inspect` and crash dumps.
 *
 * `VOLTD_ISSUER` is optional: the natural value is the backend's own public API
 * base, which is where these routes are mounted — `BETTER_AUTH_URL` plus the
 * app's `/v1` prefix.
 *
 * @param env - environment map, defaulting to `process.env`
 */
export const readVoltdTokenConfig = (
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = defaultReadFile,
): VoltdTokenConfig | null => {
  const privateKeyPem = readKey(env.VOLTD_JWT_PRIVATE_KEY_PEM, env.VOLTD_JWT_PRIVATE_KEY_FILE, readFile)
  const publicKeyPem = readKey(env.VOLTD_JWT_PUBLIC_KEY_PEM, env.VOLTD_JWT_PUBLIC_KEY_FILE, readFile)
  if (!privateKeyPem.trim() || !publicKeyPem.trim()) return null

  const issuer = resolveVoltdIssuer(env.VOLTD_ISSUER ?? '', env.BETTER_AUTH_URL ?? '')
  if (!issuer) return null

  return {
    issuer,
    audience: env.VOLTD_AUDIENCE?.trim() || 'volt',
    privateKeyPem,
    publicKeyPem,
    ttlSeconds: clampTtl(env.VOLTD_TOKEN_TTL_SECONDS),
  }
}

const defaultReadFile = (path: string): string => readFileSync(path, 'utf-8')

/**
 * Resolve a PEM from either an inline variable or a file path.
 *
 * The file form is the one a container can actually use: a PEM is multi-line and
 * `env_file` cannot carry it, and a private key in an environment variable leaks
 * into `docker inspect`, process listings and crash dumps. The inline form stays
 * for tests and for platforms that inject secrets as values.
 *
 * An unreadable path yields an empty string, which leaves the whole feature inert
 * rather than crashing the backend at startup over a misconfigured key path.
 *
 * @param inline - the `*_PEM` variable
 * @param path - the `*_FILE` variable
 * @param readFile - injected for tests
 */
const readKey = (
  inline: string | undefined,
  path: string | undefined,
  readFile: (path: string) => string,
): string => {
  if (inline?.trim()) return inline
  const trimmedPath = path?.trim()
  if (!trimmedPath) return ''
  try {
    return readFile(trimmedPath)
  } catch {
    return ''
  }
}

const clampTtl = (raw: string | undefined): number => {
  const parsed = Number(raw ?? '')
  if (!Number.isFinite(parsed) || parsed <= 0) return voltdMaxTokenTtlSeconds
  return Math.min(Math.max(Math.trunc(parsed), minTokenTtlSeconds), voltdMaxTokenTtlSeconds)
}

/**
 * Resolves the issuer string, preferring an explicit override and otherwise
 * deriving `${betterAuthUrl}/v1` — the base these routes answer on. Returns an
 * empty string when the result would not satisfy voltd, so a misconfigured
 * deployment mints nothing instead of minting tokens the gateway rejects.
 *
 * @param override - `VOLTD_ISSUER`, if set
 * @param betterAuthUrl - the backend's public base URL
 */
export const resolveVoltdIssuer = (override: string, betterAuthUrl: string): string => {
  const candidate = override.trim() || (betterAuthUrl.trim() ? `${stripTrailingSlashes(betterAuthUrl)}/v1` : '')
  if (!candidate) return ''
  const normalized = stripTrailingSlashes(candidate)
  return isValidVoltdIssuer(normalized) ? normalized : ''
}

const stripTrailingSlashes = (value: string): string => value.trim().replace(/\/+$/, '')

const loopbackHosts = new Set(['localhost', '::1', '[::1]'])
const ipv4LoopbackPattern = /^127(?:\.\d{1,3}){3}$/

/**
 * Whether a hostname is loopback, i.e. plain-text transport to it cannot leave
 * the machine. Shared with the gateway-URL check so both places agree on what
 * "local" means.
 *
 * @param hostname - a parsed URL's hostname
 */
export const isLoopbackHostname = (hostname: string): boolean =>
  loopbackHosts.has(hostname) || ipv4LoopbackPattern.test(hostname) || hostname.endsWith('.localhost')

/**
 * Whether a string is usable as the `iss` claim: absolute http(s), no query,
 * fragment or credentials, no trailing slash, and https unless the host is
 * loopback (voltd accepts plain http only there).
 *
 * @param issuer - candidate issuer
 */
export const isValidVoltdIssuer = (issuer: string): boolean => {
  if (!URL.canParse(issuer)) return false
  const url = new URL(issuer)
  if (url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') return false
  if (issuer.endsWith('/')) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return isLoopbackHostname(url.hostname)
}

/**
 * Whether a gateway URL is safe to send a minted access token to: `wss:`
 * anywhere, `ws:` only to a loopback host. A misconfigured `ws://` to a LAN or
 * remote gateway would put the token on the wire in clear text, so the provider
 * refuses to dial rather than leaking it.
 *
 * @param gatewayUrl - the configured gateway ACP endpoint
 */
export const isSecureGatewayUrl = (gatewayUrl: string): boolean => {
  if (!URL.canParse(gatewayUrl)) return false
  const url = new URL(gatewayUrl)
  if (url.username !== '' || url.password !== '') return false
  if (url.protocol === 'wss:') return true
  return url.protocol === 'ws:' && isLoopbackHostname(url.hostname)
}

/**
 * Builds the token service. Keys are imported once; `kid` is the JWK thumbprint
 * (RFC 7638), so it is stable across restarts and a key rotation changes it
 * automatically — add the new key to the JWKS, sign with it, and drop the old
 * one once no issued token can still be in flight.
 *
 * @param config - resolved configuration
 */
export const createVoltdTokenService = async (config: VoltdTokenConfig): Promise<VoltdTokenService> => {
  const privateKey = await importPKCS8(config.privateKeyPem, voltdSigningAlg)
  const publicJwk: JWK = {
    ...(await exportJWK(await importSPKI(config.publicKeyPem, voltdSigningAlg))),
    alg: voltdSigningAlg,
    use: 'sig',
  }
  publicJwk.kid = await calculateJwkThumbprint(publicJwk)

  const mint = async (principal: VoltdPrincipal): Promise<string> => {
    if (!principal.userId.trim()) throw new Error('voltd token requires a non-empty subject')
    return new SignJWT({ client_id: voltdClientId, groups: principal.groups })
      .setProtectedHeader({ alg: voltdSigningAlg, kid: publicJwk.kid, typ: 'at+jwt' })
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setSubject(principal.userId)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime(`${config.ttlSeconds}s`)
      .sign(privateKey)
  }

  return {
    issuer: config.issuer,
    audience: config.audience,
    ttlSeconds: config.ttlSeconds,
    jwks: { keys: [publicJwk] },
    mint,
  }
}

/**
 * Pulls group names off a session user. `groups` is not part of the upstream
 * `User` type — it arrives as a Better Auth additional field, populated through
 * Better Auth's provider-agnostic SSO seam (a group-membership mapper on
 * Keycloak, an equivalent claim from ADFS/Okta/Entra) or set by an admin on a
 * deployment with no identity provider at all. The gateway never learns which:
 * it trusts this backend as its only issuer, which is what keeps the identity
 * provider pluggable. Read defensively, and non-string entries are dropped
 * rather than forwarded.
 *
 * @param user - session user, shape unknown at this boundary
 */
export const readPrincipalGroups = (user: unknown): string[] => {
  const raw = (user as { groups?: unknown } | null | undefined)?.groups
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}
