/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { QueryableDatabase } from '@/db/client'
import { beforeEach, describe, expect, it } from 'bun:test'
import {
  defaultGroupsClaimPath,
  forkProvisionVoltdGroups,
  readGroupsClaim,
  readGroupsClaimPath,
  readTrustedIssuers,
  resetClaimNameLoggingForTesting,
  voltdGroupsExtraFields,
} from './groups'

const trustedIssuer = 'https://keycloak.example/realms/volt'
const fromTrustedProvider = { issuer: trustedIssuer, providerId: 'sso' }

describe('readGroupsClaimPath', () => {
  it('defaults to the gateway pilot value', () => {
    expect(readGroupsClaimPath({})).toBe('groups')
    expect(defaultGroupsClaimPath).toBe('groups')
  })

  it('honours an override and trims it', () => {
    expect(readGroupsClaimPath({ VOLTD_GROUPS_CLAIM: ' realm_access.roles ' })).toBe('realm_access.roles')
  })

  it('falls back when the override is blank', () => {
    expect(readGroupsClaimPath({ VOLTD_GROUPS_CLAIM: '   ' })).toBe('groups')
  })
})

describe('readTrustedIssuers', () => {
  it('takes whichever of the OIDC and SAML issuers the deployment configured', () => {
    expect(readTrustedIssuers({ oidcIssuer: trustedIssuer, samlIdpIssuer: '' })).toEqual([trustedIssuer])
    expect(readTrustedIssuers({ oidcIssuer: '', samlIdpIssuer: 'urn:idp' })).toEqual(['urn:idp'])
  })

  it('is empty when nothing is configured, so no provider is trusted by default', () => {
    expect(readTrustedIssuers({ oidcIssuer: '  ', samlIdpIssuer: undefined as unknown as string })).toEqual([])
  })
})

describe('readGroupsClaim', () => {
  it('reads a flat claim — Keycloak group membership, Entra, Okta', () => {
    expect(readGroupsClaim({ groups: ['volt-crm', 'volt-admins'] }, 'groups')).toEqual(['volt-crm', 'volt-admins'])
  })

  it('reads a nested claim — Keycloak realm roles', () => {
    const claims = { realm_access: { roles: ['volt-crm'] } }
    expect(readGroupsClaim(claims, 'realm_access.roles')).toEqual(['volt-crm'])
  })

  it('drops entries the gateway could never match', () => {
    expect(readGroupsClaim({ groups: ['ok', '', '  ', 7, null, {}] }, 'groups')).toEqual(['ok'])
  })

  // Each of these is a misconfiguration to be read off the log, not a reason to
  // break someone's sign-in.
  it.each([
    ['the claim is absent', { other: ['x'] }, 'groups'],
    ['the path walks through a non-object', { groups: 'volt-crm' }, 'groups.nested'],
    ['the leaf is a bare string rather than an array', { groups: 'volt-crm' }, 'groups'],
    ['the leaf is null', { groups: null }, 'groups'],
    ['a nested segment is missing', { realm_access: {} }, 'realm_access.roles'],
    ['the path is empty', { groups: ['x'] }, ''],
  ])('returns an empty list when %s', (_label, claims, path) => {
    expect(readGroupsClaim(claims as Record<string, unknown>, path)).toEqual([])
  })
})

type Write = { groups: string[]; userId: unknown }

/** Records writes instead of performing them; `failing` makes the write reject. */
const fakeDb = (failing = false) => {
  const writes: Write[] = []
  const database = {
    update: () => ({
      set: (values: { groups: string[] }) => ({
        where: (clause: unknown) => {
          if (failing) return Promise.reject(new Error('connection lost'))
          writes.push({ groups: values.groups, userId: clause })
          return Promise.resolve()
        },
      }),
    }),
  } as unknown as QueryableDatabase
  return { database, writes }
}

const logs = () => {
  const entries: Array<{ level: 'info' | 'warn'; obj: object; msg: string }> = []
  return {
    logger: {
      info: (obj: object, msg: string) => entries.push({ level: 'info', obj, msg }),
      warn: (obj: object, msg: string) => entries.push({ level: 'warn', obj, msg }),
    },
    entries,
  }
}

describe('forkProvisionVoltdGroups', () => {
  beforeEach(() => resetClaimNameLoggingForTesting())

  it('writes the claim values', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups', trustedIssuers: [trustedIssuer] })
    await provision({ provider: fromTrustedProvider, user: { id: 'user-1' }, userInfo: { groups: ['volt-crm'] } })
    expect(writes).toHaveLength(1)
    expect(writes[0].groups).toEqual(['volt-crm'])
  })

  it('overwrites rather than merging, so a removal propagates', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups', trustedIssuers: [trustedIssuer] })
    await provision({
      provider: fromTrustedProvider,
      user: { id: 'user-1', groups: ['volt-crm', 'volt-admins'] },
      userInfo: { groups: ['volt-crm'] },
    })
    expect(writes[0].groups).toEqual(['volt-crm'])
  })

  it('clears the column when the provider stops sending the claim', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups', trustedIssuers: [trustedIssuer] })
    await provision({ provider: fromTrustedProvider, user: { id: 'user-1', groups: ['volt-crm'] }, userInfo: {} })
    expect(writes[0].groups).toEqual([])
  })

  it('skips the write when nothing changed — this runs on every sign-in', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups', trustedIssuers: [trustedIssuer] })
    await provision({ provider: fromTrustedProvider, user: { id: 'user-1', groups: ['volt-crm'] }, userInfo: { groups: ['volt-crm'] } })
    expect(writes).toHaveLength(0)
  })

  // The plugin awaits this before setting the session cookie, so a throw here
  // would stop the user signing in at all.
  it('swallows a failing write so the user can still sign in', async () => {
    const { database } = fakeDb(true)
    const { logger, entries } = logs()
    const provision = forkProvisionVoltdGroups({ database, logger, claimPath: 'groups', trustedIssuers: [trustedIssuer] })
    await expect(provision({ provider: fromTrustedProvider, user: { id: 'user-1' }, userInfo: { groups: ['volt-crm'] } })).resolves.toBeUndefined()
    expect(entries.some((entry) => entry.level === 'warn')).toBe(true)
  })

  it('survives a provider that sends no claims at all', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups', trustedIssuers: [trustedIssuer] })
    await expect(
      provision({
        provider: fromTrustedProvider,
        user: { id: 'user-1' },
        userInfo: undefined as unknown as Record<string, unknown>,
      }),
    ).resolves.toBeUndefined()
    expect(writes).toHaveLength(0)
  })

  // /sso/register is gated by sessionMiddleware alone, so any signed-in user can
  // register an OIDC provider they control unless registration is disabled. If it
  // ever is enabled, a provider the operator did not configure must not be able to
  // assert group membership — that would be a complete authorization bypass, since
  // the gateway's permission profiles key on this column.
  it('ignores group claims from a provider this deployment did not configure', async () => {
    const { database, writes } = fakeDb()
    const { logger, entries } = logs()
    const provision = forkProvisionVoltdGroups({
      database,
      logger,
      claimPath: 'groups',
      trustedIssuers: [trustedIssuer],
    })

    await provision({
      provider: { issuer: 'https://attacker.example', providerId: 'mine' },
      user: { id: 'user-1' },
      userInfo: { groups: ['volt-admins'] },
    })

    expect(writes).toHaveLength(1)
    expect(writes[0].groups).toEqual([])
    expect(entries.some((entry) => entry.level === 'warn')).toBe(true)
  })

  it('clears a group the configured provider once granted when an untrusted one signs in', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({
      database,
      claimPath: 'groups',
      trustedIssuers: [trustedIssuer],
    })

    await provision({
      provider: { issuer: 'https://attacker.example' },
      user: { id: 'user-1', groups: ['volt-crm'] },
      userInfo: { groups: ['volt-crm'] },
    })

    expect(writes[0].groups).toEqual([])
  })

  it.each([
    ['no provider at all', undefined],
    ['a provider with no issuer', { providerId: 'sso' }],
    ['a non-string issuer', { issuer: 42 }],
  ])('refuses to trust %s', async (_label, provider) => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({
      database,
      claimPath: 'groups',
      trustedIssuers: [trustedIssuer],
    })
    await provision({ provider, user: { id: 'user-1' }, userInfo: { groups: ['volt-admins'] } })
    expect(writes[0].groups).toEqual([])
  })

  it('logs the claim NAMES once, and never their values', async () => {
    const { database } = fakeDb()
    const { logger, entries } = logs()
    const provision = forkProvisionVoltdGroups({ database, logger, claimPath: 'groups', trustedIssuers: [trustedIssuer] })
    const userInfo = { groups: ['volt-crm'], email: 'person@example.test', sub: 'abc' }

    await provision({ provider: fromTrustedProvider, user: { id: 'user-1' }, userInfo })
    await provision({ provider: fromTrustedProvider, user: { id: 'user-2' }, userInfo })

    const infos = entries.filter((entry) => entry.level === 'info')
    expect(infos).toHaveLength(1)
    expect(infos[0].obj).toEqual({ claimPath: 'groups', claimNames: ['email', 'groups', 'sub'] })
    // The values — an email address and a subject id — must not be in the log.
    expect(JSON.stringify(infos[0].obj)).not.toContain('person@example.test')
    expect(JSON.stringify(infos[0].obj)).not.toContain('abc')
  })
})

describe('voltdGroupsExtraFields', () => {
  // The whole point: the SSO plugin keeps the five fields it maps plus whatever
  // extraFields names, and drops every other claim before provisionUser runs.
  // Without this mapping the live sign-in produced a user with no groups and no
  // agents, with nothing failing anywhere.
  it('asks for the claim the dotted path addresses', () => {
    expect(voltdGroupsExtraFields('groups')).toEqual({ groups: 'groups' })
  })

  it('asks for the ROOT object of a nested path, which the dotted reader then walks', () => {
    expect(voltdGroupsExtraFields('realm_access.roles')).toEqual({ realm_access: 'realm_access' })
  })

  it('asks for nothing when the path is blank, rather than for a field named ""', () => {
    expect(voltdGroupsExtraFields('')).toEqual({})
    expect(voltdGroupsExtraFields('   ')).toEqual({})
  })

  it('defaults to the configured claim path', () => {
    expect(voltdGroupsExtraFields()).toEqual({ [defaultGroupsClaimPath]: defaultGroupsClaimPath })
  })
})
