/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { defaultTaskConnectEmail } from '@/defaults/tasks'
import { defaultTaskRuConnectEmail } from '@/defaults/tasks-ru'
import { localizeDefaultTask } from './localize-default-task'

describe('localizeDefaultTask', () => {
  test('passes non-ru locales through unchanged', () => {
    expect(localizeDefaultTask(defaultTaskConnectEmail, 'en')).toEqual(defaultTaskConnectEmail)
  })

  test('swaps item text for a known id when locale is ru', () => {
    const localized = localizeDefaultTask(defaultTaskConnectEmail, 'ru')
    expect(localized.item).toBe(defaultTaskRuConnectEmail.item)
    expect(localized.id).toBe(defaultTaskConnectEmail.id)
  })

  test('passes through unchanged for an unknown id even when locale is ru', () => {
    const custom = { id: 'user-created-task-id', item: 'A user task' }
    expect(localizeDefaultTask(custom, 'ru')).toEqual(custom)
  })
})
