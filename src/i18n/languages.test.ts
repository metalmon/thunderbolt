/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { detectUiLanguage, normalizeUiLanguage, type UiLanguage } from './languages'

describe('normalizeUiLanguage', () => {
  test('accepts en and ru', () => {
    expect(normalizeUiLanguage('en')).toBe('en')
    expect(normalizeUiLanguage('ru')).toBe('ru')
  })

  test('maps unknown / empty / null to en', () => {
    expect(normalizeUiLanguage(null)).toBe('en')
    expect(normalizeUiLanguage(undefined)).toBe('en')
    expect(normalizeUiLanguage('')).toBe('en')
    expect(normalizeUiLanguage('de')).toBe('en')
    expect(normalizeUiLanguage('EN')).toBe('en')
  })
})

describe('detectUiLanguage', () => {
  test('ru and ru-* → ru', () => {
    expect(detectUiLanguage('ru')).toBe('ru')
    expect(detectUiLanguage('ru-RU')).toBe('ru')
    expect(detectUiLanguage('ru_RU')).toBe('ru')
  })

  test('everything else → en', () => {
    expect(detectUiLanguage('en-US')).toBe('en')
    expect(detectUiLanguage('de-DE')).toBe('en')
    expect(detectUiLanguage('')).toBe('en')
  })
})

const _languages: UiLanguage[] = ['en', 'ru']
void _languages
