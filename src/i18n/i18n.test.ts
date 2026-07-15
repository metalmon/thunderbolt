/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import i18n, { setUiLanguage } from './i18n'

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
