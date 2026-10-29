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
 * The language this run speaks, from the environment.
 *
 * Order: `VOLT_LANG` (and its legacy spelling) wins, because it is the one knob
 * that exists for this purpose; then the POSIX `LC_ALL`/`LANG`, which is what a
 * Linux or macOS user has already set and what a terminal tool is expected to
 * honour; then English.
 *
 * Matching is on the base language only — `ru_RU.UTF-8`, `ru-RU` and `ru` all
 * mean Russian here. The CLI ships one Russian catalog, so distinguishing
 * regions would buy nothing and would turn a perfectly good `LANG` into English.
 *
 * Windows sets neither `LANG` nor `LC_ALL`, so a Russian user there names the
 * language explicitly — that is why the dedicated variable comes first rather
 * than as a fallback.
 */
export const resolveCliLocale = (env: Readonly<Record<string, string | undefined>> = process.env): CliLocale => {
  const requested = envVar('LANG', env) ?? env.LC_ALL ?? env.LANG
  const base = requested?.trim().toLowerCase().split(/[_.@-]/)[0]
  return base === 'ru' ? 'ru' : 'en'
}

/** The `I18n` for this run. Resolved once: a CLI process has one language. */
export const i18n = getI18n(resolveCliLocale())
