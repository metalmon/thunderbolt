/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mockAuth } from '@/test-utils/mock-auth'
import { createGeminiLiveRoutes } from './routes'

describe('Gemini Live routes', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('creates a route without crashing', async () => {
    const app = createGeminiLiveRoutes({ auth: mockAuth, apiKey: '' })
    // WebSocket routes don't respond to plain HTTP GET — they expect a WS upgrade.
    // Verify the route is created and doesn't throw on any request.
    const res = await app.handle(new Request('http://localhost/gemini-live/'))
    expect(res).toBeDefined()
    expect(typeof res.status).toBe('number')
  })

  it('creates a route when using env variable', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const app = createGeminiLiveRoutes({ auth: mockAuth })
    const res = await app.handle(new Request('http://localhost/gemini-live/'))
    expect(res).toBeDefined()
  })
})
