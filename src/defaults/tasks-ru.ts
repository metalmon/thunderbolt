/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Russian display text for the built-in demo tasks (`src/defaults/tasks.ts`).
 * Consumed by `localizeDefaultTask` for render-time localization only — the
 * stored `item` stays canonical English so reconcile's content hash
 * (`hashTask`) and `defaultTasksVersion` are unaffected.
 */
export const defaultTaskRuConnectEmail = {
  id: '0198ecc5-cc2b-735b-b478-93f8db7202ce',
  item: 'Подключите вашу почту, чтобы начать',
} as const

export const defaultTaskRuSetPreferences = {
  id: '0198ecc5-cc2b-735b-b478-96071aa92f62',
  item: 'Укажите имя и местоположение в настройках для более точных ответов ИИ',
} as const

export const defaultTaskRuExplorePro = {
  id: '0198ecc5-cc2b-735b-b478-99e9874d61ba',
  item: 'Изучите инструменты Вольт Про для расширения возможностей',
} as const

/**
 * Array of all default tasks' Russian text, for building the id → item map.
 */
export const defaultTasksRu = [defaultTaskRuConnectEmail, defaultTaskRuSetPreferences, defaultTaskRuExplorePro] as const
