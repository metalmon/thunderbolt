/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { mockAuth } from '@/test-utils/mock-auth'
import { createGeminiLiveRoutes } from './routes'

describe('Gemini Live routes', () => {
  it('returns 503 when GEMINI_API_KEY is not set', async () => {
    const original = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY

    const app = createGeminiLiveRoutes({ auth: mockAuth, apiKey: '' })
    const res = await app.handle(new Request('http://localhost/gemini-live/'))
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('Gemini provider not configured')

    if (original) {
      process.env.GEMINI_API_KEY = original
    }
  })

  it('returns 503 when apiKey option is empty and env is unset', async () => {
    const original = process.env.GEMINI_API_KEY
    delete process.env.GEMINI_API_KEY

    const app = createGeminiLiveRoutes({ auth: mockAuth })
    const res = await app.handle(new Request('http://localhost/gemini-live/'))
    expect(res.status).toBe(503)

    if (original) {
      process.env.GEMINI_API_KEY = original
    }
  })
})
