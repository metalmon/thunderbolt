/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  areAllLocalizationSettingsUnset,
  localizationDefaultsForLanguage,
  type LocalizationUnitDefaults,
} from './localization-defaults'
import type { UiLanguage } from './languages'

export type LocalizationStoredValues = {
  distance_unit: string | null | undefined
  temperature_unit: string | null | undefined
  date_format: string | null | undefined
  time_format: string | null | undefined
  currency: string | null | undefined
}

/**
 * Persist language-specific localization unit defaults when all five keys are still unset.
 * Does not overwrite existing user/country choices.
 */
export const applyLocalizationDefaultsIfNeeded = async (input: {
  language: UiLanguage
  stored: LocalizationStoredValues
  setValues: (defaults: LocalizationUnitDefaults) => Promise<unknown>
}): Promise<boolean> => {
  if (!areAllLocalizationSettingsUnset(input.stored)) {
    return false
  }
  await input.setValues(localizationDefaultsForLanguage(input.language))
  return true
}
