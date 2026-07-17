/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { UiLanguage } from './languages'

export type LocalizationUnitDefaults = {
  distance_unit: string
  temperature_unit: string
  date_format: string
  time_format: string
  currency: string
}

/** US-style fallbacks used when language is English / unknown. */
export const EN_LOCALIZATION_DEFAULTS: LocalizationUnitDefaults = {
  distance_unit: 'imperial',
  temperature_unit: 'f',
  date_format: 'MM/DD/YYYY',
  time_format: '12h',
  currency: 'USD',
}

/** Defaults for Russian UI language (matches Open-Meteo / units-by-country RU). */
export const RU_LOCALIZATION_DEFAULTS: LocalizationUnitDefaults = {
  distance_unit: 'metric',
  temperature_unit: 'c',
  date_format: 'DD/MM/YYYY',
  time_format: '24h',
  currency: 'RUB',
}

/**
 * Returns shipped localization unit defaults for a UI language.
 */
export const localizationDefaultsForLanguage = (language: UiLanguage): LocalizationUnitDefaults =>
  language === 'ru' ? RU_LOCALIZATION_DEFAULTS : EN_LOCALIZATION_DEFAULTS

/**
 * True when a localization setting has never been persisted (DB null/empty).
 * Do not use display fallbacks from useSettings — those mask unset state.
 */
export const isLocalizationSettingUnset = (stored: string | null | undefined): boolean =>
  stored == null || stored === ''

/**
 * True when all five localization unit keys are still unset in storage.
 */
export const areAllLocalizationSettingsUnset = (stored: {
  distance_unit: string | null | undefined
  temperature_unit: string | null | undefined
  date_format: string | null | undefined
  time_format: string | null | undefined
  currency: string | null | undefined
}): boolean =>
  isLocalizationSettingUnset(stored.distance_unit) &&
  isLocalizationSettingUnset(stored.temperature_unit) &&
  isLocalizationSettingUnset(stored.date_format) &&
  isLocalizationSettingUnset(stored.time_format) &&
  isLocalizationSettingUnset(stored.currency)
