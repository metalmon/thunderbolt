/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it } from 'bun:test'
import { getSystemLanguages, loadSystemLocale } from './system-locale'

afterEach(async () => {
  await loadSystemLocale(async () => null)
})

describe('loadSystemLocale', () => {
  it('publishes the OS tag for negotiation', async () => {
    await loadSystemLocale(async () => 'ru-RU')

    expect(getSystemLanguages()).toEqual(['ru-RU'])
  })

  // The web has no OS to ask, and an OS that answers nothing must not become an
  // empty tag — `resolveLocale` would then negotiate against `['']`.
  it('publishes nothing when there is no answer', async () => {
    await loadSystemLocale(async () => null)

    expect(getSystemLanguages()).toEqual([])
  })
})
