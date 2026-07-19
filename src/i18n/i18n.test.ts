/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, test } from 'bun:test'
import i18n, { setUiLanguage } from './i18n'
import { detectUiLanguage } from './languages'

describe('i18n init', () => {
  test('loads english common strings', () => {
    setUiLanguage('en')
    expect(i18n.t('common:appName')).toBe('Thunderbolt')
  })

  test('switches to russian settings keys', async () => {
    setUiLanguage('ru')
    expect(i18n.t('settings:localization.languageLabel')).toBe('Язык')
    setUiLanguage('en')
  })
})

describe('initial language from OS locale', () => {
  it('selects ru for a Russian OS locale', () => {
    expect(detectUiLanguage('ru-RU')).toBe('ru')
  })
  it('falls back to en for non-Russian locales', () => {
    expect(detectUiLanguage('en-US')).toBe('en')
    expect(detectUiLanguage(undefined)).toBe('en')
  })
})
