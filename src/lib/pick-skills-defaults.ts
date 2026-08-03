/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { eq } from 'drizzle-orm'
import type { AnyDrizzleDatabase } from '@/db/database-interface'
import { settingsTable, skillsTable } from '@/db/tables'
import { defaultSkills, defaultSkillsVersion } from '@/defaults/skills'
import { defaultSkillsRu } from '@/defaults/skills-ru'
import { detectUiLanguage, normalizeUiLanguage, type UiLanguage } from '@/i18n/languages'
import { readClientLocale } from '@/i18n/ensure-ui-language'
import type { Skill } from '@/types'

/** Skills defaults source handed to `reconcileDefaults`. Mirrors `ModelsDefaults`
 *  so the built-in skill catalog can be seeded in the user's UI language. */
export type SkillsDefaults = { version: number; data: readonly Skill[] }

/** A Cyrillic slug means the skills were seeded in Russian (RU slugs are
 *  Cyrillic — `поиск`, `погода`, …; EN slugs are Latin — `search`, `weather`). */
const skillsLanguageFromSlug = (slug: string): UiLanguage => (/[а-яё]/i.test(slug) ? 'ru' : 'en')

/**
 * Pick the built-in skill defaults in the user's language.
 *
 * Once skills are seeded their language is LOCKED — detected from an existing
 * row's slug — so a later UI-language switch never re-localizes them ("first
 * seed only", the product decision). Only a fresh account (no skill rows)
 * follows the stored `ui_language`, or the client locale before onboarding has
 * persisted it. RU and EN share `defaultSkillsVersion`, so a language switch
 * alone never trips the reconcile version gate — only a genuine content bump
 * does, and it then re-applies in whatever language was seeded.
 */
export const pickSkillsDefaults = async (db: AnyDrizzleDatabase): Promise<SkillsDefaults> => {
  const existing = await db.select({ name: skillsTable.name }).from(skillsTable).limit(1)
  const language: UiLanguage =
    existing.length > 0 && existing[0]?.name
      ? skillsLanguageFromSlug(existing[0].name)
      : await pickFreshSeedLanguage(db)
  return { version: defaultSkillsVersion, data: language === 'ru' ? defaultSkillsRu : defaultSkills }
}

/** Language for a first-ever seed: the stored `ui_language` if set, else the
 *  client locale (so a RU-browser user gets RU skills even on the very first
 *  boot, before onboarding has written the setting). */
const pickFreshSeedLanguage = async (db: AnyDrizzleDatabase): Promise<UiLanguage> => {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, 'ui_language'))
  const stored = rows[0]?.value as string | null | undefined
  return stored ? normalizeUiLanguage(stored) : detectUiLanguage(readClientLocale())
}
