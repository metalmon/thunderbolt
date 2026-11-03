/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb } from '@/db/database'
import { agentsTable } from '@/db/tables'
import { createAgent } from '@/dal/agents'
import { resetTestDatabase, teardownTestDatabase } from '@/dal/test-utils'
import { adoptLocalAgents, adoptLocalAgentsOnSignIn, type SessionReader } from './adopt-local-agents'
import { localAgentOwnerId } from './agent-owner'

const addAgent = async (id: string, userId: string) =>
  createAgent(getDb(), {
    id,
    name: id,
    type: 'remote-acp',
    transport: 'websocket',
    url: 'wss://example.test/ws',
    userId,
  })

const ownerOf = async (id: string) =>
  (await getDb().select().from(agentsTable).where(eq(agentsTable.id, id)).get())?.userId ?? null

const sessionFor = (id: string | null): SessionReader => ({
  getSession: async () => ({ data: id === null ? null : { user: { id } } }),
})

describe('adoptLocalAgents', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await teardownTestDatabase()
  })

  // What the move MEANS for an owner-scoped read is asserted where the scoping lives
  // (`ownedBy` in `src/dal/agents.ts`, on the seams branch). Here the subject is the
  // rewrite itself, so these read rows directly and this file stays standalone.
  it('moves marked rows to the new owner and reports the count', async () => {
    await addAgent('local-a', localAgentOwnerId)
    await addAgent('local-b', localAgentOwnerId)

    expect(await adoptLocalAgents(getDb(), 'user-1')).toBe(2)
    expect(await ownerOf('local-a')).toBe('user-1')
    expect(await ownerOf('local-b')).toBe('user-1')
  })

  it("never touches another account's rows", async () => {
    await addAgent('theirs', 'user-2')
    await addAgent('local', localAgentOwnerId)

    await adoptLocalAgents(getDb(), 'user-1')

    expect(await ownerOf('theirs')).toBe('user-2')
    expect(await ownerOf('local')).toBe('user-1')
  })

  it('gives the data to the FIRST account to sign in, and nothing to the second', async () => {
    await addAgent('local', localAgentOwnerId)

    expect(await adoptLocalAgents(getDb(), 'first')).toBe(1)
    expect(await adoptLocalAgents(getDb(), 'second')).toBe(0)
    expect(await ownerOf('local')).toBe('first')
  })

  it('is idempotent — a second pass changes nothing', async () => {
    await addAgent('local', localAgentOwnerId)

    await adoptLocalAgents(getDb(), 'user-1')
    expect(await adoptLocalAgents(getDb(), 'user-1')).toBe(0)
    expect(await ownerOf('local')).toBe('user-1')
  })

  it('refuses to adopt into the mark itself', async () => {
    await addAgent('local', localAgentOwnerId)

    expect(await adoptLocalAgents(getDb(), localAgentOwnerId)).toBe(0)
    expect(await ownerOf('local')).toBe(localAgentOwnerId)
  })

  it('does nothing when there is nothing marked (the "start clean" path)', async () => {
    await addAgent('theirs', 'user-2')

    expect(await adoptLocalAgents(getDb(), 'user-1')).toBe(0)
  })
})

describe('adoptLocalAgentsOnSignIn', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  afterAll(async () => {
    await teardownTestDatabase()
  })

  it('reads the signed-in id from the client, not from the caller', async () => {
    await addAgent('local', localAgentOwnerId)

    await adoptLocalAgentsOnSignIn(sessionFor('user-9'))

    expect(await ownerOf('local')).toBe('user-9')
  })

  it('leaves the rows alone when no session resolved', async () => {
    await addAgent('local', localAgentOwnerId)

    await adoptLocalAgentsOnSignIn(sessionFor(null))

    expect(await ownerOf('local')).toBe(localAgentOwnerId)
  })

  it('never throws, so a failure here cannot leave sync off', async () => {
    await addAgent('local', localAgentOwnerId)
    const broken: SessionReader = {
      getSession: async () => {
        throw new Error('session read failed')
      },
    }

    await adoptLocalAgentsOnSignIn(broken)

    expect(await ownerOf('local')).toBe(localAgentOwnerId)
  })
})
