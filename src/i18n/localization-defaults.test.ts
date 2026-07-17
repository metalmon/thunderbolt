/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import {
  areAllLocalizationSettingsUnset,
  EN_LOCALIZATION_DEFAULTS,
  localizationDefaultsForLanguage,
  RU_LOCALIZATION_DEFAULTS,
} from './localization-defaults'

describe('localizationDefaultsForLanguage', () => {
  test('returns Russian unit defaults for ru', () => {
    expect(localizationDefaultsForLanguage('ru')).toEqual({
      distance_unit: 'metric',
      temperature_unit: 'c',
      date_format: 'DD/MM/YYYY',
      time_format: '24h',
      currency: 'RUB',
    })
    expect(localizationDefaultsForLanguage('ru')).toBe(RU_LOCALIZATION_DEFAULTS)
  })

  test('returns English unit defaults for en', () => {
    expect(localizationDefaultsForLanguage('en')).toEqual(EN_LOCALIZATION_DEFAULTS)
  })
})

describe('areAllLocalizationSettingsUnset', () => {
  test('true when every key is null or empty', () => {
    expect(
      areAllLocalizationSettingsUnset({
        distance_unit: null,
        temperature_unit: undefined,
        date_format: '',
        time_format: null,
        currency: null,
      }),
    ).toBe(true)
  })

  test('false when any key is already persisted', () => {
    expect(
      areAllLocalizationSettingsUnset({
        distance_unit: 'metric',
        temperature_unit: null,
        date_format: null,
        time_format: null,
        currency: null,
      }),
    ).toBe(false)
  })
})
