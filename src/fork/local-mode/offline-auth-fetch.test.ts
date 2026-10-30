/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { createOfflineAuthFetch } from './offline-auth-fetch'

describe('the auth transport on an install with no auth server', () => {
  // ⚠ Four components call `useSession`, so this answer is what turns three
  // refused requests per boot into none. Reported from a real install: the
  // console filled with `/api/auth/get-session` failures in local mode.
  it('answers get-session with "no session", without a network call', async () => {
    const response = await createOfflineAuthFetch()('https://backend.example/v1/api/auth/get-session')

    expect(response.status).toBe(200)
    expect(await response.json()).toBeNull()
  })

  it('reads the session path off a Request and a URL too', async () => {
    const offline = createOfflineAuthFetch()
    const fromUrl = await offline(new URL('https://backend.example/v1/api/auth/get-session'))
    const fromRequest = await offline(new Request('https://backend.example/v1/api/auth/get-session'))

    expect(await fromUrl.json()).toBeNull()
    expect(await fromRequest.json()).toBeNull()
  })

  // A sign-in here is not a failure to retry: it is something this install
  // cannot do. Saying 503 beats a silent success that leaves the caller waiting
  // for a session that will never arrive.
  it('refuses everything else instead of pretending it worked', async () => {
    const response = await createOfflineAuthFetch()('https://backend.example/v1/api/auth/sign-in/anonymous')

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('without an authentication') })
  })
})
