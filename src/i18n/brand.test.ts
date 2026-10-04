/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The brand reaches the UI through the catalogs, not the source: upstream writes
 * "Thunderbolt" in the msgid and `dev-local/i18n-brand-swap.mjs` rewrites the
 * translations (msgstr) so a sync never conflicts over it.
 *
 * That makes an empty msgstr invisible rather than loud — gettext falls straight
 * back to the msgid, so the screen simply shows "Thunderbolt" with every string
 * around it translated. Exactly that shipped on the signed-out screen.
 *
 * A render test cannot catch it: `src/testing-library.ts` mocks the Lingui macros
 * with identity implementations that render the English source, so the assertion
 * has to be on the catalog.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const catalog = (locale: string) =>
  readFileSync(resolve(import.meta.dirname, '..', 'locales', locale, 'messages.po'), 'utf-8')

/** The msgstr for an exact msgid, or '' when untranslated. */
const translationOf = (po: string, msgid: string): string | null => {
  const match = po.match(new RegExp(`^msgid "${msgid}"\\nmsgstr "(.*)"$`, 'm'))
  return match ? match[1] : null
}

describe('brand translations', () => {
  it('ships the brand as a translatable message at all', () => {
    expect(translationOf(catalog('en'), 'Thunderbolt')).not.toBeNull()
  })

  it.each([
    ['ru', 'Вольт'],
    ['en', 'Volt'],
  ])('renders the fork brand in %s', (locale, expected) => {
    expect(translationOf(catalog(locale), 'Thunderbolt')).toBe(expected)
  })

  it('never leaves the brand untranslated, which would silently show the upstream name', () => {
    for (const locale of ['ru', 'en']) {
      expect(translationOf(catalog(locale), 'Thunderbolt')).not.toBe('')
    }
  })

  // Not just the standalone brand: any translated sentence that names the product
  // must carry the fork's name too. "Welcome to Thunderbolt!" is the one that went
  // unnoticed — it reads correctly in the source, so only the shipped translation
  // reveals it.
  it.each(['ru', 'en'])('leaves no %s translation still naming the upstream product', (locale) => {
    const offenders = [...catalog(locale).matchAll(/^msgstr(?:\[\d\])? "(.*Thunderbolt.*)"$/gm)].map((m) => m[1])
    expect(offenders).toEqual([])
  })
})
