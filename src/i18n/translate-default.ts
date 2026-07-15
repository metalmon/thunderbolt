/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { TFunction } from 'i18next'
import { BUILTIN_MODE_IDS, BUILTIN_SKILL_IDS, BUILTIN_TASK_IDS } from './builtin-default-ids'

type DefaultKind = 'modes' | 'skills' | 'tasks'

const BUILTIN: Record<DefaultKind, Set<string>> = {
  modes: BUILTIN_MODE_IDS,
  skills: BUILTIN_SKILL_IDS,
  tasks: BUILTIN_TASK_IDS,
}

/** Translate a built-in default entity field; custom ids return fallback unchanged. */
export const translateDefaultField = (
  t: TFunction,
  kind: DefaultKind,
  id: string,
  field: string,
  fallback: string,
): string => {
  if (!BUILTIN[kind].has(id)) return fallback
  return t(`${kind}.${id}.${field}`, { ns: 'defaults', defaultValue: fallback })
}
