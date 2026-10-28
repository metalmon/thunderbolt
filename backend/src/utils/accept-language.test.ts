/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { acceptLanguageFor } from './accept-language'

const englishChain = 'en-US,en;q=0.9'

describe('acceptLanguageFor', () => {
  // Fork: the offered set is en + ru, both base-language tags, so the regional rung
  // (`pt-BR,pt;q=0.9,en;q=0.8`) has nothing to exercise here. A locale upstream ships
  // but this build does not offer is exactly what must not be forwarded — asserted below.
  it('falls straight back to English for a base-language tag', () => {
    expect(acceptLanguageFor('ru')).toBe('ru,en;q=0.9')
  })

  it('leaves English users on exactly their current chain', () => {
    expect(acceptLanguageFor('en')).toBe(englishChain)
  })

  it('defaults to English when the header is absent', () => {
    expect(acceptLanguageFor(null)).toBe(englishChain)
    expect(acceptLanguageFor(undefined)).toBe(englishChain)
  })

  it('tolerates surrounding whitespace, as every other backend header read does', () => {
    expect(acceptLanguageFor(' ru ')).toBe('ru,en;q=0.9')
  })

  // Only a dev build can send it, and it is a private-use subtag no upstream honours.
  it('defaults to English for the pseudo-locale', () => {
    expect(acceptLanguageFor('en-XA')).toBe(englishChain)
  })

  // The value is client-controlled and lands in an outbound request to a
  // user-supplied URL, so nothing outside the shipped set may be forwarded.
  it('forwards nothing that is not a shipped locale', () => {
    expect(acceptLanguageFor('zh-CN')).toBe(englishChain)
    expect(acceptLanguageFor('pt-BR')).toBe(englishChain)
    expect(acceptLanguageFor('de')).toBe(englishChain)
    expect(acceptLanguageFor('de\r\nX-Injected: 1')).toBe(englishChain)
    expect(acceptLanguageFor('*')).toBe(englishChain)
  })
})
