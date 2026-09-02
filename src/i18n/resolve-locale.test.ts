/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { negotiableLocales } from '@shared/i18n/locales'
import { resolveLocale, settableLocales } from './resolve-locale'

// Volt ships only `en` (source) and `ru` (product language), plus the `en-XA`
// CI pseudo-locale. With no explicit setting and no browser match the resolver
// falls back to `ru` (defaultLocale), not the English source — Volt is
// Russian-first.
describe('resolveLocale', () => {
  test('explicit supported setting wins over browser languages', () => {
    expect(resolveLocale('ru', ['en', 'en-US'])).toBe('ru')
  })

  test('explicit en setting is returned as-is', () => {
    expect(resolveLocale('en', ['ru'])).toBe('en')
  })

  // `language` is synced, so a dev-build selection would otherwise land on that
  // developer's production devices and render the whole UI as pseudo-text. Tests
  // run with `import.meta.env.DEV` unset, i.e. against the production contract.
  test('refuses the en-XA pseudo-locale outside dev builds', () => {
    expect(settableLocales).not.toContain('en-XA')
    expect(resolveLocale('en-XA', ['en'])).toBe('en')
  })

  test('unsupported setting falls through to browser negotiation', () => {
    expect(resolveLocale('zh-CN', ['ru-RU', 'en'])).toBe('ru')
  })

  test('null setting uses the first matching browser language', () => {
    expect(resolveLocale(null, ['ru-RU', 'en-US'])).toBe('ru')
  })

  test('matches a regional tag to its base locale', () => {
    expect(resolveLocale(null, ['en-US', 'ru'])).toBe('en')
  })

  test('maps a regional tag to the base shipped locale (ru-RU → ru)', () => {
    expect(resolveLocale(null, ['ru-RU'])).toBe('ru')
  })

  test('strips regions when only the base is shipped (en-GB → en)', () => {
    expect(resolveLocale(null, ['en-GB'])).toBe('en')
  })

  test('is case-insensitive on browser tags', () => {
    expect(resolveLocale(null, ['RU'])).toBe('ru')
    expect(resolveLocale(null, ['EN-us'])).toBe('en')
  })

  test('skips unsupported browser languages until one matches', () => {
    expect(resolveLocale(null, ['zh-CN', 'ko', 'ru-RU'])).toBe('ru')
  })

  test('falls back to ru (default) when nothing matches', () => {
    expect(resolveLocale(null, ['zh-CN', 'ko'])).toBe('ru')
  })

  test('falls back to ru (default) on an empty browser list', () => {
    expect(resolveLocale(null, [])).toBe('ru')
  })

  test('never negotiates the en-XA pseudo-locale from the browser', () => {
    // en-XA is not negotiable; its base `en` is, so the tag resolves to `en`,
    // never to the pseudo-locale itself.
    expect(resolveLocale(null, ['en-XA'])).toBe('en')
    expect(negotiableLocales).not.toContain('en-XA')
  })
})
