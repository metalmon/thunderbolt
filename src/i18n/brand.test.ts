/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Where the product name comes from, and where it must NOT come from.
 *
 * Since upstream's operator branding (#1439) the name is deployment config:
 * `BRANDING.appName`, read through `getAppName()`/`<AppWordmark />`. The brand is
 * therefore no longer a translatable message — a translator cannot rename the
 * product, and no catalog carries a standalone "Thunderbolt" entry any more.
 *
 * What upstream has NOT moved to the placeholder is the handful of sentences that
 * still spell the name out. Those the fork rewrites in the TRANSLATION values
 * (`dev-local/i18n-brand-swap.mjs`, a step of `i18n:extract`) so nothing in `src/`
 * is edited and an upstream sync never conflicts over the brand. This pins both
 * halves: the swap still covers every such sentence, and the brand has not crept
 * back into the catalogs as copy.
 *
 * A render test cannot do this job: `src/testing-library.ts` mocks the Lingui
 * macros with identity implementations that render the English source, so the
 * assertion has to be on the catalog.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveAppName } from '@shared/branding'

const catalog = (locale: string) =>
  readFileSync(resolve(import.meta.dirname, '..', 'locales', locale, 'messages.po'), 'utf-8')

/** The msgstr for an exact msgid, or null when the catalog has no such entry. */
const translationOf = (po: string, msgid: string): string | null => {
  const match = po.match(new RegExp(`^msgid "${msgid}"\\nmsgstr "(.*)"$`, 'm'))
  return match ? match[1] : null
}

describe('the product name', () => {
  it('comes from the deployment, not from a catalog', () => {
    expect(resolveAppName({ appName: 'Вольт' })).toBe('Вольт')
    // No branding configured — and for the autonomous product that is the
    // NORMAL state, not an edge case: an install with no server never receives
    // a `/config` at all. Upstream's default was kept here until a real install
    // showed what it means — our client introducing itself as Thunderbolt on
    // the first screen the user sees. The catalogs still carry no fork string
    // (the next two cases pin that); this one value is the exception, and it
    // lives in `shared/branding.ts` rather than in a message.
    expect(resolveAppName(undefined)).toBe('Вольт')
  })

  // The standalone brand used to be `<Trans>Thunderbolt</Trans>` with the fork's
  // name in the msgstr. `<AppWordmark />` replaced it, so an entry reappearing
  // here means a screen went back to treating the brand as translatable copy.
  it.each(['ru', 'en'])('is not a translatable message in %s', (locale) => {
    expect(translationOf(catalog(locale), 'Thunderbolt')).toBeNull()
  })
})

describe('brand swap', () => {
  // Any translated sentence that names the product must carry the fork's name.
  // "Welcome to Thunderbolt!" is the one that went unnoticed before: it reads
  // correctly in the source, so only the shipped translation reveals it.
  it.each(['ru', 'en'])('leaves no %s translation still naming the upstream product', (locale) => {
    const offenders = [...catalog(locale).matchAll(/^msgstr(?:\[\d\])? "(.*Thunderbolt.*)"$/gm)].map((m) => m[1])
    expect(offenders).toEqual([])
  })

  // The swap only has value while upstream still spells the name out somewhere;
  // if this ever reaches zero, `i18n-brand-swap.mjs` has nothing left to do and
  // should go rather than linger as a no-op step in `i18n:extract`.
  it('still has sentences to cover', () => {
    const spelledOut = [...catalog('en').matchAll(/^msgid "(.*Thunderbolt.*)"$/gm)]
    expect(spelledOut.length).toBeGreaterThan(0)
  })
})
