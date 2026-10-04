/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `user.groups` is authorization input: the backend asserts it in the token a
 * voltd gateway maps onto permission profiles. If a user could write it they
 * could grant themselves any agent the gateway offers — so the field is declared
 * `input: false`, and these are the tests that hold that line.
 *
 * Route-level on purpose. A unit test of the declaration would pass whether or not
 * Better Auth honours the flag; only driving the real endpoints proves it. An
 * anonymous session is used because it is the cheapest real session this backend
 * issues — the property under test has nothing to do with how the user signed in.
 */

import { createAuth } from '@/auth/auth'
import { clearSettingsCache } from '@/config/settings'
import { user } from '@/db/schema'
import { createTestDb } from '@/test-utils/db'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'

let savedAllowAnonymous: string | undefined

beforeAll(() => {
  savedAllowAnonymous = process.env.AUTH_ALLOW_ANONYMOUS
  process.env.AUTH_ALLOW_ANONYMOUS = 'true'
  clearSettingsCache()
})

afterAll(() => {
  if (savedAllowAnonymous === undefined) delete process.env.AUTH_ALLOW_ANONYMOUS
  else process.env.AUTH_ALLOW_ANONYMOUS = savedAllowAnonymous
  clearSettingsCache()
})

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

  const rows = () => db.select().from(user)

  // There is deliberately no create-path test. The only endpoint that would take
  // arbitrary user fields on creation is email+password sign-up, and this
  // deployment has it disabled outright (`EMAIL_PASSWORD_SIGN_UP_DISABLED`); the
  // paths that do create users — anonymous sign-in and email OTP — accept no such
  // body. A test there would pass whether or not the field were protected, because
  // no user is created at all. `input: false` still covers creation if a sign-up
  // path is ever enabled; what cannot be done today is prove it here.

  it('never lets update-user overwrite what provisioning wrote', async () => {
    const signIn = (await auth.api.signInAnonymous({ asResponse: true })) as Response
    const cookie = signIn.headers.get('set-cookie')
    expect(cookie).toBeTruthy()

    const [created] = await rows()
    // What the SSO provisioning hook would have written.
    await db.update(user).set({ groups: ['volt-crm'] }).where(eq(user.id, created.id))

    await auth.api
      .updateUser({
        body: { groups: ['volt-admins'] } as never,
        headers: new Headers({ cookie: cookie! }),
      })
      .catch(() => undefined)

    const [after] = await rows()
    expect(after.groups).toEqual(['volt-crm'])
  })

  it('leaves the column empty for a session that was never provisioned', async () => {
    await auth.api.signInAnonymous({ asResponse: true })
    const [created] = await rows()
    expect(created.groups).toEqual([])
  })

  // The escalation this closes: /sso/register is gated by sessionMiddleware alone,
  // so without providersLimit: 0 any signed-in user could register an identity
  // provider they control and have it assert `volt-admins`.
  it('refuses to let a signed-in user register their own identity provider', async () => {
    const signIn = (await auth.api.signInAnonymous({ asResponse: true })) as Response
    const cookie = signIn.headers.get('set-cookie')!

    const response = await auth.handler(
      new Request('http://localhost/api/auth/sso/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          providerId: 'attacker',
          issuer: 'https://attacker.example',
          domain: 'attacker.example',
          oidcConfig: { clientId: 'x', clientSecret: 'y', issuer: 'https://attacker.example' },
        }),
      }),
    )

    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})
