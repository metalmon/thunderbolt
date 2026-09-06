/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defaultSkillsRu } from '@/defaults/skills-ru'
import type { Skill } from '@/types'
import type { AppLocale } from '@shared/i18n/locales'

/**
 * Render-time localization of the built-in skills' user-facing text.
 *
 * The skill rows in the DB stay canonical (upstream English): that keeps the
 * reconcile content-hash stable (translating stored default rows would break
 * cross-device reconciliation — AGENTS.md, THU-811) and keeps the `instruction`
 * — which is MODEL-facing — in English. Only the `label` and `description` a
 * human reads are swapped here, at the display boundary, so switching the UI
 * language re-localizes them instantly with no re-seed and no version bump.
 *
 * User-created skills and any id we don't ship a translation for pass through
 * unchanged.
 */
const ruById: ReadonlyMap<string, { label: string; description: string }> = new Map(
  defaultSkillsRu.map((skill) => [skill.id, { label: skill.label, description: skill.description }]),
)

/** Swap a built-in skill's label + description into `locale` for display. Only
 *  `ru` is translated; every other locale returns the skill untouched. */
export const localizeDefaultSkill = <T extends Pick<Skill, 'id' | 'label' | 'description'>>(
  skill: T,
  locale: AppLocale,
): T => {
  if (locale !== 'ru') {
    return skill
  }
  const ru = ruById.get(skill.id)
  return ru ? { ...skill, label: ru.label, description: ru.description } : skill
}
