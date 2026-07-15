/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { resolveInitialUiLanguage } from './ensure-ui-language'

describe('resolveInitialUiLanguage', () => {
  test('keeps explicit setting', () => {
    expect(resolveInitialUiLanguage({ stored: 'ru', locale: 'en-US' })).toEqual({
      language: 'ru',
      shouldPersist: false,
    })
  })

  test('detects when unset', () => {
    expect(resolveInitialUiLanguage({ stored: null, locale: 'ru-RU' })).toEqual({
      language: 'ru',
      shouldPersist: true,
    })
    expect(resolveInitialUiLanguage({ stored: null, locale: 'en-US' })).toEqual({
      language: 'en',
      shouldPersist: true,
    })
  })

  test('normalizes garbage stored values without re-detect', () => {
    expect(resolveInitialUiLanguage({ stored: 'de', locale: 'ru-RU' })).toEqual({
      language: 'en',
      shouldPersist: false,
    })
  })
})
