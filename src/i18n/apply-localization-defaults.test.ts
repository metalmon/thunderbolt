/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { applyLocalizationDefaultsIfNeeded } from './apply-localization-defaults'
import { RU_LOCALIZATION_DEFAULTS } from './localization-defaults'

describe('applyLocalizationDefaultsIfNeeded', () => {
  test('persists Russian defaults when all units unset', async () => {
    let written: unknown
    const applied = await applyLocalizationDefaultsIfNeeded({
      language: 'ru',
      stored: {
        distance_unit: null,
        temperature_unit: null,
        date_format: null,
        time_format: null,
        currency: null,
      },
      setValues: async (defaults) => {
        written = defaults
      },
    })
    expect(applied).toBe(true)
    expect(written).toEqual(RU_LOCALIZATION_DEFAULTS)
  })

  test('does not overwrite when any unit already set', async () => {
    let calls = 0
    const applied = await applyLocalizationDefaultsIfNeeded({
      language: 'ru',
      stored: {
        distance_unit: 'imperial',
        temperature_unit: null,
        date_format: null,
        time_format: null,
        currency: null,
      },
      setValues: async () => {
        calls += 1
      },
    })
    expect(applied).toBe(false)
    expect(calls).toBe(0)
  })
})
