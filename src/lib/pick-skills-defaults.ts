/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { eq } from 'drizzle-orm'
import type { AnyDrizzleDatabase } from '@/db/database-interface'
import { settingsTable } from '@/db/tables'
import { defaultSkills, defaultSkillsVersion } from '@/defaults/skills'
import { defaultSkillsRu } from '@/defaults/skills-ru'
import { getActiveLocale } from '@/i18n/active-locale'
import type { Skill } from '@/types'

/** The two languages the built-in skill catalog is seeded in. */
type SkillsLanguage = 'en' | 'ru'

/** Skills defaults source handed to `reconcileDefaults`. Mirrors `ModelsDefaults`
 *  so the built-in skill catalog can be seeded in the user's UI language. */
export type SkillsDefaults = { version: number; data: readonly Skill[] }

/**
 * Pick the built-in skill defaults in the user's language.
 *
 * The catalog follows the CURRENT UI language, not the language of a first seed:
 * Volt is Russian-first, ships no cloud sync, and the reconcile hash-gate already
 * protects user-edited skills — so an unmodified default should always render in
 * the language the user is actually reading. (Upstream's "lock to the first seed's
 * slug" made sense for a synced, English-first product; here it just stranded a
 * Russian user on whatever language their account was first seeded in.)
 *
 * RU and EN share `defaultSkillsVersion`, so switching language alone never trips
 * the reconcile version gate — the re-localization lands on the next genuine
 * content bump, which then re-applies every unmodified default in the UI language.
 */
export const pickSkillsDefaults = async (db: AnyDrizzleDatabase): Promise<SkillsDefaults> => {
  const language = await pickSeedLanguage(db)
  return { version: defaultSkillsVersion, data: language === 'ru' ? defaultSkillsRu : defaultSkills }
}

/** Resolve the seed language: the stored `language` setting if set, else the
 *  resolved active locale. `en-XA` (the dev pseudo-locale) and every non-Russian
 *  locale fall to English. */
const pickSeedLanguage = async (db: AnyDrizzleDatabase): Promise<SkillsLanguage> => {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, 'language'))
  const stored = rows[0]?.value as string | null | undefined
  if (stored) {
    return stored === 'ru' ? 'ru' : 'en'
  }
  return getActiveLocale() === 'ru' ? 'ru' : 'en'
}
