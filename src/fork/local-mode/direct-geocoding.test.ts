/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import type { HttpClient } from '@/lib/http'
import { placeByIdDirect, searchPlacesDirect } from './direct-geocoding'

type Call = { url: string; searchParams: Record<string, unknown> }

/** Records the request and answers with `body`; only `.get().json()` is used. */
const clientReturning = (body: unknown) => {
  const calls: Call[] = []
  const httpClient = {
    get: (url: string, options?: { searchParams?: Record<string, unknown> }) => {
      calls.push({ url, searchParams: options?.searchParams ?? {} })
      return { json: async () => body }
    },
  } as unknown as HttpClient
  return { httpClient, calls }
}

describe('searchPlacesDirect', () => {
  // ⚠ The whole point: an autonomous install has no `/v1/locations`, so the
  // request must go to the provider itself. Shipped without this and the place
  // picker in Settings failed on every install with no server.
  it('asks the provider, not our backend', async () => {
    const { httpClient, calls } = clientReturning({ results: [] })

    await searchPlacesDirect(httpClient, 'Мюнхен', 'ru')

    expect(calls[0]?.url).toBe('https://geocoding-api.open-meteo.com/v1/search')
    expect(calls[0]?.searchParams).toMatchObject({ name: 'Мюнхен', count: 10, language: 'ru' })
  })

  // The backend narrows the tag before calling the provider; if this path did
  // not, `de-AT` would return different names than the server path for the same
  // query, and a stored place would re-resolve differently depending on mode.
  it('narrows the language tag the way the backend does', async () => {
    const { httpClient, calls } = clientReturning({ results: [] })

    await searchPlacesDirect(httpClient, 'Wien', 'de-AT')

    expect(calls[0]?.searchParams.language).toBe('de')
  })

  it('maps the provider fields onto the shape the caller expects', async () => {
    const { httpClient } = clientReturning({
      results: [
        {
          id: 2867714,
          name: 'München',
          admin1: 'Bayern',
          country: 'Deutschland',
          country_code: 'DE',
          latitude: 48.13,
          longitude: 11.58,
        },
      ],
    })

    expect(await searchPlacesDirect(httpClient, 'München', 'de')).toEqual([
      {
        id: 2867714,
        name: 'München',
        region: 'Bayern',
        country: 'Deutschland',
        countryCode: 'DE',
        lat: 48.13,
        lon: 11.58,
      },
    ])
  })

  // Every field is optional in the provider's schema, and an absent `results`
  // is their "no matches" answer rather than a failure.
  it('survives a sparse answer', async () => {
    const { httpClient } = clientReturning({})
    expect(await searchPlacesDirect(httpClient, 'x', 'en')).toEqual([])

    const sparse = clientReturning({ results: [{}] })
    expect(await searchPlacesDirect(sparse.httpClient, 'x', 'en')).toEqual([
      { id: 0, name: '', region: '', country: '', countryCode: '', lat: 0, lon: 0 },
    ])
  })
})

describe('placeByIdDirect', () => {
  it('re-resolves one place by the provider id', async () => {
    const { httpClient, calls } = clientReturning({ id: 2867714, name: 'Munich', country: 'Germany' })

    const place = await placeByIdDirect(httpClient, 2867714, 'en-GB')

    expect(calls[0]?.url).toBe('https://geocoding-api.open-meteo.com/v1/get')
    expect(calls[0]?.searchParams).toMatchObject({ id: 2867714, language: 'en' })
    expect(place.name).toBe('Munich')
  })
})
