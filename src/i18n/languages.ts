/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type UiLanguage = 'en' | 'ru'

export const UI_LANGUAGES: readonly UiLanguage[] = ['en', 'ru'] as const

/** Normalize a stored/raw value to a supported UI language. Unknown → en. */
export const normalizeUiLanguage = (value: string | null | undefined): UiLanguage => {
  const lowered = value?.trim().toLowerCase()
  if (lowered === 'en' || lowered === 'ru') return lowered
  return 'en'
}

/**
 * Map a BCP-47 / OS locale string to a UI language.
 * Only Russian locales select `ru`; all others select `en`.
 */
export const detectUiLanguage = (locale: string | null | undefined): UiLanguage => {
  const normalized = locale?.trim().toLowerCase().replace('_', '-') ?? ''
  if (normalized === 'ru' || normalized.startsWith('ru-')) return 'ru'
  return 'en'
}
