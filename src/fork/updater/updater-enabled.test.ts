/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, afterEach } from 'bun:test'
import { isUpdaterEnabled } from './updater-enabled'

const env = import.meta.env as Record<string, string | undefined>
const original = env.VITE_UPDATER_ENABLED

afterEach(() => {
  env.VITE_UPDATER_ENABLED = original
})

describe('isUpdaterEnabled', () => {
  it('stays on when the variable is unset, so an ordinary build keeps updating', () => {
    delete env.VITE_UPDATER_ENABLED
    expect(isUpdaterEnabled()).toBe(true)
  })

  it('turns off only on the exact string "false"', () => {
    env.VITE_UPDATER_ENABLED = 'false'
    expect(isUpdaterEnabled()).toBe(false)
  })

  it('stays on for "true"', () => {
    env.VITE_UPDATER_ENABLED = 'true'
    expect(isUpdaterEnabled()).toBe(true)
  })

  it('stays on for anything else — a typo must not silently disable updates', () => {
    for (const value of ['False', 'FALSE', '0', 'no', 'off', '']) {
      env.VITE_UPDATER_ENABLED = value
      expect(isUpdaterEnabled()).toBe(true)
    }
  })
})
