/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setupI18n, type I18n, type Messages } from '@lingui/core'
import { messages as en } from '../locales/en/messages.ts'
import { messages as ru } from '../locales/ru/messages.ts'
import { envVar } from './identity.ts'

/** The locales this CLI ships. See `cli/lingui.config.ts` for why only two. */
export type CliLocale = 'en' | 'ru'

const catalogs: Record<CliLocale, Messages> = { en, ru }

/**
 * ⚠ **No macros here.** Bun has no Babel pass, so `@lingui/core/macro` resolves
 * to Lingui's stub and throws when called — the same trap the backend's email
 * copy documents. Every string goes through the plain runtime:
 * `i18n._({ id: 'English text' })`. Extraction is unaffected: the extractor
 * matches `i18n._` by identifier name.
 */
const instances = new Map<CliLocale, I18n>()

/** A memoized `I18n` for one locale. */
export const getI18n = (locale: CliLocale): I18n => {
  const existing = instances.get(locale)
  if (existing) {
    return existing
  }
  const created = setupI18n({ locale, messages: { [locale]: catalogs[locale] } })
  instances.set(locale, created)
  return created
}

/**
 * The language this run speaks.
 *
 * Nobody should have to set anything: the common case is a person who installed
 * the binary and expects it to speak their system's language. So the ORDER is:
 *
 * 1. `VOLT_LANG` — the explicit override, for forcing a language against the
 *    system's (and for scripts and tests). It wins everywhere.
 * 2. **The operating system's own language**, via `Intl`. This is the one that
 *    makes the product work without instructions.
 * 3. POSIX `LC_ALL`/`LANG`, as a last resort.
 *
 * ⚠ `LANG` is NOT trusted ahead of the system language, and this is measured
 * rather than assumed: on Windows, Git Bash exports `LANG=en_US.UTF-8` by
 * itself. On a Russian Windows — the pilot's primary platform — `Intl` reports
 * `ru-RU` while `LANG` claims English. Reading `LANG` first would hand every
 * such user an English interface and look like the detection simply did not
 * work. On Linux the question does not arise: ICU derives its default locale
 * from `LC_ALL`/`LC_MESSAGES`/`LANG`, so `Intl` already carries the same answer,
 * and the POSIX fallback stays only for a runtime that reports nothing useful.
 *
 * Matching is on the base language: `ru_RU.UTF-8`, `ru-RU` and `ru` all mean
 * Russian. One Russian catalog ships, so distinguishing regions would buy
 * nothing and would turn a perfectly good signal into English.
 */
export const resolveCliLocale = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  systemLocale: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().locale,
): CliLocale => {
  const baseOf = (tag: string | undefined): string | undefined =>
    tag
      ?.trim()
      .toLowerCase()
      .split(/[_.@-]/)[0] || undefined
  // First DEFINED candidate decides — not "any candidate says ru". `VOLT_LANG=en`
  // on a Russian system must give English, which is the whole point of having an
  // override.
  const base = [baseOf(envVar('LANG', env)), baseOf(systemLocale()), baseOf(env.LC_ALL ?? env.LANG)].find(
    (candidate) => candidate !== undefined,
  )
  return base === 'ru' ? 'ru' : 'en'
}

/** The `I18n` for this run. Resolved once: a CLI process has one language. */
export const i18n = getI18n(resolveCliLocale())
