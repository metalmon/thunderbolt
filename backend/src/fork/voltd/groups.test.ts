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
  resetClaimNameLoggingForTesting,
} from './groups'

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
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups' })
    await provision({ user: { id: 'user-1' }, userInfo: { groups: ['volt-crm'] } })
    expect(writes).toHaveLength(1)
    expect(writes[0].groups).toEqual(['volt-crm'])
  })

  it('overwrites rather than merging, so a removal propagates', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups' })
    await provision({
      user: { id: 'user-1', groups: ['volt-crm', 'volt-admins'] },
      userInfo: { groups: ['volt-crm'] },
    })
    expect(writes[0].groups).toEqual(['volt-crm'])
  })

  it('clears the column when the provider stops sending the claim', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups' })
    await provision({ user: { id: 'user-1', groups: ['volt-crm'] }, userInfo: {} })
    expect(writes[0].groups).toEqual([])
  })

  it('skips the write when nothing changed — this runs on every sign-in', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups' })
    await provision({ user: { id: 'user-1', groups: ['volt-crm'] }, userInfo: { groups: ['volt-crm'] } })
    expect(writes).toHaveLength(0)
  })

  // The plugin awaits this before setting the session cookie, so a throw here
  // would stop the user signing in at all.
  it('swallows a failing write so the user can still sign in', async () => {
    const { database } = fakeDb(true)
    const { logger, entries } = logs()
    const provision = forkProvisionVoltdGroups({ database, logger, claimPath: 'groups' })
    await expect(provision({ user: { id: 'user-1' }, userInfo: { groups: ['volt-crm'] } })).resolves.toBeUndefined()
    expect(entries.some((entry) => entry.level === 'warn')).toBe(true)
  })

  it('survives a provider that sends no claims at all', async () => {
    const { database, writes } = fakeDb()
    const provision = forkProvisionVoltdGroups({ database, claimPath: 'groups' })
    await expect(
      provision({ user: { id: 'user-1' }, userInfo: undefined as unknown as Record<string, unknown> }),
    ).resolves.toBeUndefined()
    expect(writes).toHaveLength(0)
  })

  it('logs the claim NAMES once, and never their values', async () => {
    const { database } = fakeDb()
    const { logger, entries } = logs()
    const provision = forkProvisionVoltdGroups({ database, logger, claimPath: 'groups' })
    const userInfo = { groups: ['volt-crm'], email: 'person@example.test', sub: 'abc' }

    await provision({ user: { id: 'user-1' }, userInfo })
    await provision({ user: { id: 'user-2' }, userInfo })

    const infos = entries.filter((entry) => entry.level === 'info')
    expect(infos).toHaveLength(1)
    expect(infos[0].obj).toEqual({ claimPath: 'groups', claimNames: ['email', 'groups', 'sub'] })
    // The values — an email address and a subject id — must not be in the log.
    expect(JSON.stringify(infos[0].obj)).not.toContain('person@example.test')
    expect(JSON.stringify(infos[0].obj)).not.toContain('abc')
  })
})
