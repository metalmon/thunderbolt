/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `user.groups` is authorization input: the backend asserts it in the token a
 * voltd gateway maps onto permission profiles. If a user could write it, they
 * could grant themselves any agent the gateway offers — so the field is declared
 * `input: false`, and these are the tests that hold that line.
 *
 * Route-level on purpose. A unit test of the declaration would pass whether or not
 * Better Auth honours the flag; only driving the real endpoints proves it.
 */

import { createAuth } from '@/auth/auth'
import { user } from '@/db/schema'
import { createTestDb } from '@/test-utils/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

describe('user.groups is not user-writable', () => {
  let auth: ReturnType<typeof createAuth>
  let db: Awaited<ReturnType<typeof createTestDb>>['db']
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const testEnv = await createTestDb()
    db = testEnv.db
    cleanup = testEnv.cleanup
    auth = createAuth(db)
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
  })

  const readGroups = async (email: string) => {
    const rows = await db.select().from(user).where(eq(user.email, email))
    return rows[0]?.groups
  }

  it('ignores groups supplied at sign-up', async () => {
    const email = 'escalate-create@example.com'
    await auth.api.signUpEmail({
      body: {
        email,
        password: 'testpassword123',
        name: 'Test User',
        // The attack: ask for a group the gateway maps to its operator profile.
        groups: ['volt-admins'],
      } as unknown as Parameters<typeof auth.api.signUpEmail>[0]['body'],
    })

    expect(await readGroups(email)).toEqual([])
  })

  it('ignores groups supplied to update-user, leaving what provisioning wrote', async () => {
    const email = 'escalate-update@example.com'
    const signUp = await auth.api.signUpEmail({
      body: { email, password: 'testpassword123', name: 'Test User' },
      asResponse: true,
    })
    const cookie = signUp.headers.get('set-cookie') ?? ''
    expect(cookie).not.toBe('')

    // What the SSO provisioning hook would have written.
    await db.update(user).set({ groups: ['volt-crm'] }).where(eq(user.email, email))

    await auth.api
      .updateUser({
        body: { groups: ['volt-admins'] } as unknown as Parameters<typeof auth.api.updateUser>[0]['body'],
        headers: new Headers({ cookie }),
      })
      .catch(() => undefined) // A rejection is an acceptable outcome; a write is not.

    expect(await readGroups(email)).toEqual(['volt-crm'])
  })
})
