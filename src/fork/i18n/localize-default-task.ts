/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defaultTasksRu } from '@/defaults/tasks-ru'
import type { Task } from '@/types'
import type { AppLocale } from '@shared/i18n/locales'

/**
 * Render-time localization of the built-in demo tasks' user-facing text.
 *
 * The task rows in the DB stay canonical (upstream English): that keeps the
 * reconcile content-hash (`hashTask`) stable (translating stored default rows
 * would break cross-device reconciliation — AGENTS.md, THU-811). Only `item`
 * — the text a human reads — is swapped here, at the display boundary, so
 * switching the UI language re-localizes it instantly with no re-seed and no
 * version bump.
 *
 * User-created tasks and any id we don't ship a translation for pass through
 * unchanged.
 */
const ruById: ReadonlyMap<string, Pick<Task, 'item'>> = new Map(
  defaultTasksRu.map((task) => [task.id, { item: task.item }]),
)

/** Swap a built-in task's `item` into `locale` for display. Only `ru` is
 *  translated; every other locale returns the task untouched. */
export const localizeDefaultTask = <T extends Pick<Task, 'id' | 'item'>>(task: T, locale: AppLocale): T => {
  if (locale !== 'ru') {
    return task
  }
  const ru = ruById.get(task.id)
  return ru ? { ...task, item: ru.item } : task
}
