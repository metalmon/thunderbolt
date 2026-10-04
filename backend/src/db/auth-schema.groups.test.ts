/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `user.groups` is the only native array column in this schema, and the database
 * every backend test runs on is PGlite rather than postgres. The column type was
 * therefore gated on proving it round-trips here before anything was built on top
 * of it — see docs/superpowers/specs/2026-10-04-user-groups-provisioning-design.md.
 */

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { closeSharedIsolatedTestDb, getSharedIsolatedTestDb, type IsolatedTestDb } from '@/test-utils/db'
import { user } from './auth-schema'

let handle: IsolatedTestDb
const db = () => handle.db

let seq = 0
const insert = async (groups?: string[]) => {
  const id = `groups-test-${++seq}`
  await db()
    .insert(user)
    .values({ id, name: 'Test', email: `${id}@example.test`, ...(groups ? { groups } : {}) })
  return id
}

const read = async (id: string) => (await db().select().from(user).where(eq(user.id, id)).limit(1))[0]

describe('user.groups on PGlite', () => {
  beforeAll(async () => {
    handle = await getSharedIsolatedTestDb()
  })

  afterAll(async () => {
    await closeSharedIsolatedTestDb()
  })

  it('defaults to an empty array for a row that never sets it', async () => {
    const row = await read(await insert())
    expect(row.groups).toEqual([])
  })

  it('round-trips several values in order', async () => {
    const row = await read(await insert(['volt-admins', 'volt-crm']))
    expect(row.groups).toEqual(['volt-admins', 'volt-crm'])
  })

  it('round-trips values that would break a naive serializer', async () => {
    const awkward = ['group,with,commas', 'group"with"quotes', "it's", 'группа', 'with {braces}']
    const row = await read(await insert(awkward))
    expect(row.groups).toEqual(awkward)
  })

  it('overwrites rather than merging, so a removal in the IdP propagates', async () => {
    const id = await insert(['volt-admins', 'volt-crm'])
    await db().update(user).set({ groups: ['volt-crm'] }).where(eq(user.id, id))
    expect((await read(id)).groups).toEqual(['volt-crm'])
  })

  it('stores an explicitly empty array as empty, not as null', async () => {
    const row = await read(await insert([]))
    expect(row.groups).toEqual([])
  })
})
