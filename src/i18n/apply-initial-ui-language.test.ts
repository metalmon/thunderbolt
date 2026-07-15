/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, test } from 'bun:test'
import { applyInitialUiLanguageIfNeeded, resetApplyInitialUiLanguageForTests } from './apply-initial-ui-language'

describe('applyInitialUiLanguageIfNeeded', () => {
  afterEach(() => {
    resetApplyInitialUiLanguageForTests()
  })

  test('concurrent calls persist ui_language only once', async () => {
    let setValueCalls = 0
    let unblock: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve
    })

    const setValue = async (value: string) => {
      setValueCalls += 1
      await blocked
      return value
    }

    const first = applyInitialUiLanguageIfNeeded({ stored: null, setValue })
    const second = applyInitialUiLanguageIfNeeded({ stored: null, setValue })

    await Promise.resolve()
    expect(setValueCalls).toBe(1)

    unblock?.()
    await Promise.all([first, second])
    expect(setValueCalls).toBe(1)
  })

  test('clears in-flight promise on failure so retry is possible', async () => {
    let setValueCalls = 0
    const setValue = async () => {
      setValueCalls += 1
      throw new Error('persist failed')
    }

    await expect(applyInitialUiLanguageIfNeeded({ stored: null, setValue })).rejects.toThrow('persist failed')
    expect(setValueCalls).toBe(1)

    setValueCalls = 0
    await applyInitialUiLanguageIfNeeded({
      stored: null,
      setValue: async () => {
        setValueCalls += 1
      },
    })
    expect(setValueCalls).toBe(1)
  })
})
