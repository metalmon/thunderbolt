/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { i18n } from '@lingui/core'

import { getProviderDisplay } from './model-presentation'

describe('getProviderDisplay', () => {
  test('a system openrouter model is the managed lane, and brands as Volt', () => {
    expect(getProviderDisplay(i18n, { provider: 'openrouter', isSystem: 1 })).toBe('Volt')
  })

  test("a user's own OpenRouter key keeps the OpenRouter brand", () => {
    expect(getProviderDisplay(i18n, { provider: 'openrouter', isSystem: 0 })).toBe('OpenRouter')
  })

  test('the other managed shapes are unchanged', () => {
    expect(getProviderDisplay(i18n, { provider: 'thunderbolt', isSystem: 1 })).toBe('Volt')
    expect(getProviderDisplay(i18n, { provider: 'tinfoil', isSystem: 1 })).toBe('Volt')
    expect(getProviderDisplay(i18n, { provider: 'tinfoil', isSystem: 0 })).toBe('Tinfoil')
    expect(getProviderDisplay(i18n, { provider: 'anthropic', isSystem: 0 })).toBe('Anthropic')
  })
})

describe('the managed lane', () => {
  test('brands as Volt under its own provider', () => {
    expect(getProviderDisplay(i18n, { provider: 'managed', isSystem: 1 })).toBe('Volt')
    expect(getProviderDisplay(i18n, { provider: 'managed', isSystem: 0 })).toBe('Volt')
  })
})
