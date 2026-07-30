/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mockAuth } from '@/test-utils/mock-auth'
import { createGeminiLiveRoutes, upstreamUrlFor } from './routes'

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

describe('upstreamUrlFor', () => {
  it('uses v1beta BidiGenerateContent path for half-cascade + no model query', () => {
    const u = upstreamUrlFor('gemini-live-2.5-flash-preview', 'KEY123')
    expect(u).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=KEY123',
    )
  })
  it('uses v1alpha for native-audio models', () => {
    const u = upstreamUrlFor('gemini-2.5-flash-native-audio-preview', 'KEY123')
    expect(u).toContain('v1alpha.GenerativeService.BidiGenerateContent')
  })
})
