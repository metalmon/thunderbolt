/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ConsoleSpies } from '@/test-utils/console-spies'
import { setupConsoleSpy } from '@/test-utils/console-spies'
import { mockAuth, mockAuthUnauthenticated } from '@/test-utils/mock-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createOpenrouterRoutes } from './routes'

const baseUrl = 'https://openrouter.ai/api/v1'

const ok = (body = 'ok') => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })
const status = (code: number) => new Response(String(code), { status: code })
const drain = async (res: Response) => {
  if (res.body) await res.arrayBuffer()
  return res
}

describe('createOpenrouterRoutes', () => {
  let mockFetch: ReturnType<typeof mock>
  let consoleSpies: ConsoleSpies

  beforeAll(() => {
    consoleSpies = setupConsoleSpy()
    mockFetch = mock(() => Promise.resolve(ok()))
  })
  afterAll(() => consoleSpies.restore())
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation(() => Promise.resolve(ok()))
    consoleSpies.error.mockClear()
  })

  const build = (
    o: {
      apiKeys?: string[]
      freeRpm?: number
      now?: () => number
      auth?: typeof mockAuth
    } = {},
  ) =>
    new Elysia().use(
      createOpenrouterRoutes({
        auth: o.auth ?? mockAuth,
        fetchFn: mockFetch as unknown as typeof fetch,
        apiKeys: o.apiKeys ?? ['k1'],
        baseUrl,
        freeRpm: o.freeRpm ?? 1000,
        now: o.now,
      }),
    )

  const post = (app: Elysia) =>
    app.handle(
      new Request('http://localhost/openrouter/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'x', messages: [] }),
      }),
    )

  it('returns 503 when no keys are configured', async () => {
    const res = await post(build({ apiKeys: [] }))
    expect(res.status).toBe(503)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await drain(await post(build({ auth: mockAuthUnauthenticated })))
    expect(res.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 405 for disallowed methods', async () => {
    const app = build()
    const res = await app.handle(new Request('http://localhost/openrouter/x', { method: 'DELETE', body: '' }))
    expect(res.status).toBe(405)
  })

  it('injects the server key and strips inbound Authorization', async () => {
    await drain(
      await build().handle(
        new Request('http://localhost/openrouter/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer client-secret', 'content-type': 'application/json' },
          body: '{}',
        }),
      ),
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${baseUrl}/chat/completions`)
    expect((init.headers as Headers).get('authorization')).toBe('Bearer k1')
  })

  it('rotates to the next key when one returns 429', async () => {
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const auth = (init.headers as Headers).get('authorization')
      return Promise.resolve(auth === 'Bearer k1' ? status(429) : ok('from-k2'))
    })
    const res = await drain(await post(build({ apiKeys: ['k1', 'k2'], now: () => 1000 })))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('from-k2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns 429 when every key is rate-limited', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(status(429)))
    const res = await drain(await post(build({ apiKeys: ['k1', 'k2'], now: () => 1000 })))
    expect(res.status).toBe(429)
  })

  it('throttles per user beyond freeRpm', async () => {
    const app = build({ freeRpm: 1, now: () => 5000 })
    const first = await drain(await post(app))
    const second = await drain(await post(app))
    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(second.headers.get('retry-after')).toBe('60')
  })
})
