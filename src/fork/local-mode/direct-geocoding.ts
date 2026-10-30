/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { HttpClient } from '@/lib/http'
import { baseLanguage } from '@shared/i18n/base-language'

/**
 * Place search without our backend.
 *
 * ⚠ This is the one lane where the rule "disable the lane, never the
 * capability" cuts the other way: `/v1/locations` is not a service of ours, it
 * is a thin proxy over Open-Meteo's geocoding API — the same API the weather
 * widget already calls directly, through this same client, at an absolute URL.
 * So an autonomous install does not have to lose the place picker; it just has
 * to stop going the long way round. Without this the search box in Settings
 * fails on an install with no server, which is how it shipped in 0.1.148.
 *
 * The mapping mirrors `toLocationResult` in `backend/src/api/routes.ts`: the
 * backend narrows the language tag to its base subtag before the call, so this
 * does too, or the two paths would disagree on `de-AT`.
 */
const searchUrl = 'https://geocoding-api.open-meteo.com/v1/search'
const byIdUrl = 'https://geocoding-api.open-meteo.com/v1/get'
const requestTimeout = 10_000

/** What Open-Meteo returns per place; every field is optional in their schema. */
type GeocodingPlace = {
  id?: number
  name?: string
  admin1?: string
  country?: string
  country_code?: string
  latitude?: number
  longitude?: number
}

/** The shape `src/lib/locations.ts` expects back, whichever path produced it. */
export type GeocodedPlace = {
  id: number
  name: string
  region: string
  country: string
  countryCode: string
  lat: number
  lon: number
}

const toGeocodedPlace = (place: GeocodingPlace): GeocodedPlace => ({
  id: place.id ?? 0,
  name: place.name || '',
  region: place.admin1 || '',
  country: place.country || '',
  countryCode: place.country_code || '',
  lat: place.latitude || 0,
  lon: place.longitude || 0,
})

/**
 * Search places by name, straight at the provider.
 *
 * @param httpClient - the app's client; an absolute URL bypasses the backend
 *   base and still gets the platform-aware fetch underneath
 * @param query - what the user typed
 * @param language - BCP-47 tag, narrowed here as the backend narrows it
 */
export const searchPlacesDirect = async (
  httpClient: HttpClient,
  query: string,
  language: string,
): Promise<GeocodedPlace[]> => {
  const body = await httpClient
    .get(searchUrl, {
      timeout: requestTimeout,
      searchParams: { name: query, count: 10, language: baseLanguage(language), format: 'json' },
    })
    .json<{ results?: GeocodingPlace[] }>()
  return (body.results ?? []).map(toGeocodedPlace)
}

/**
 * Re-resolve one known place by its Open-Meteo id.
 *
 * @param httpClient - as above
 * @param id - the provider's own place id, the only language-independent handle
 * @param language - BCP-47 tag, narrowed here as the backend narrows it
 */
export const placeByIdDirect = async (httpClient: HttpClient, id: number, language: string): Promise<GeocodedPlace> => {
  const place = await httpClient
    .get(byIdUrl, { timeout: requestTimeout, searchParams: { id, language: baseLanguage(language) } })
    .json<GeocodingPlace>()
  return toGeocodedPlace(place)
}
