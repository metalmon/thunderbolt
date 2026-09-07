/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, mock } from 'bun:test'
import { GeminiEphemeralTokenError, mintGeminiEphemeralToken } from './gemini-ephemeral-token'

const fixedNow = () => 1_000_000

describe('mintGeminiEphemeralToken', () => {
  it('rejects a key with non-ASCII characters before touching fetch', async () => {
    const fetchImpl = mock(async () => new Response('{}', { status: 200 }))
    await expect(
      mintGeminiEphemeralToken({ apiKey: 'AIzaКириллица', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(GeminiEphemeralTokenError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts the expected request and returns the token name', async () => {
    const fetchImpl = mock(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ name: 'auth_tokens/abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    const result = await mintGeminiEphemeralToken({
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-live',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: fixedNow,
    })

    expect(result).toBe('auth_tokens/abc')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens')
    expect(init.method).toBe('POST')

    const headers = init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('test-api-key')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body as string) as {
      uses: number
      expireTime: string
      newSessionExpireTime: string
      liveConnectConstraints: {
        model: string
        config: { responseModalities: string[]; sessionResumption: Record<string, never> }
      }
    }

    expect(body.uses).toBe(1)
    expect(body.expireTime).toBe(new Date(fixedNow() + 30 * 60 * 1000).toISOString())
    expect(body.newSessionExpireTime).toBe(new Date(fixedNow() + 60 * 1000).toISOString())
    expect(body.liveConnectConstraints.model).toBe('models/gemini-2.0-flash-live')
    expect(body.liveConnectConstraints.config.responseModalities).toEqual(['AUDIO'])
    expect(body.liveConnectConstraints.config.sessionResumption).toEqual({})
  })

  it('mints on the API version matching the model (native-audio → v1alpha, else v1beta)', async () => {
    const run = async (model: string) => {
      const fetchImpl = mock(async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ name: 'auth_tokens/x' }), { status: 200 }),
      )
      await mintGeminiEphemeralToken({ apiKey: 'k', model, fetchImpl: fetchImpl as unknown as typeof fetch, now: fixedNow })
      return fetchImpl.mock.calls[0][0]
    }
    expect(await run('gemini-2.5-flash-native-audio-preview-12-2025')).toContain('/v1alpha/auth_tokens')
    expect(await run('gemini-3.1-flash-live-preview')).toContain('/v1beta/auth_tokens')
  })

  it('throws GeminiEphemeralTokenError on a non-2xx response, with the status in the message', async () => {
    const fetchImpl = mock(
      async () =>
        new Response('forbidden', {
          status: 403,
          statusText: 'Forbidden',
        }),
    )

    const call = mintGeminiEphemeralToken({
      apiKey: 'test-api-key',
      model: 'gemini-2.0-flash-live',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: fixedNow,
    })

    await expect(call).rejects.toThrow(GeminiEphemeralTokenError)
    await expect(call).rejects.toThrow(/403/)
  })

  it('throws GeminiEphemeralTokenError when a 2xx response body is not valid JSON', async () => {
    const fetchImpl = mock(
      async () =>
        new Response('not json', {
          status: 200,
        }),
    )

    await expect(
      mintGeminiEphemeralToken({
        apiKey: 'test-api-key',
        model: 'gemini-2.0-flash-live',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: fixedNow,
      }),
    ).rejects.toThrow(GeminiEphemeralTokenError)
  })

  it('throws GeminiEphemeralTokenError when the response has no valid name', async () => {
    const fetchImpl = mock(
      async () =>
        new Response(JSON.stringify({ notName: 'oops' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )

    await expect(
      mintGeminiEphemeralToken({
        apiKey: 'test-api-key',
        model: 'gemini-2.0-flash-live',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: fixedNow,
      }),
    ).rejects.toThrow(GeminiEphemeralTokenError)
  })
})
