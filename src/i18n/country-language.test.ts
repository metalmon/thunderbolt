/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { localeForRegion } from './country-language'

describe('localeForRegion', () => {
  // The geocoding provider's `country_code` reaches here untyped beyond `string`.
  // `Intl.Locale` throws `RangeError` on anything that isn't a well-formed tag,
  // and the throw would surface as a confirm dialog that never opens.
  test('returns null for anything that is not an alpha-2 region', () => {
    for (const bad of ['', 'USA', 'Brazil', 'u', '12', 'BR-SP', ' BR']) {
      expect(localeForRegion(bad)).toBeNull()
    }
  })

  test('maps a region to the shipped locale of its dominant language', () => {
    // Volt ships only `en` and `ru`, so only regions dominant in those resolve.
    expect(localeForRegion('RU')).toBe('ru')
    expect(localeForRegion('US')).toBe('en')
  })

  test('maps regional variants onto the shipped base locale', () => {
    expect(localeForRegion('GB')).toBe('en')
    expect(localeForRegion('AU')).toBe('en')
  })

  test('returns null when the app ships no catalog for the language', () => {
    // Languages upstream shipped but Volt drops all resolve to null now.
    expect(localeForRegion('DE')).toBeNull()
    expect(localeForRegion('FR')).toBeNull()
    expect(localeForRegion('MX')).toBeNull()
    expect(localeForRegion('JP')).toBeNull()
    expect(localeForRegion('PT')).toBeNull()
    expect(localeForRegion('IT')).toBeNull()
    expect(localeForRegion('PL')).toBeNull()
  })

  test('returns null when the provider gave no region', () => {
    expect(localeForRegion('')).toBeNull()
  })
})
