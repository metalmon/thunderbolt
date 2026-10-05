/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, mock } from 'bun:test'

const getDefaultModelForThread = mock(async () => ({ id: 'm1' }) as unknown)
mock.module('@/dal', () => ({ getDefaultModelForThread }))

const { resolveThreadModel } = await import('./selected-model')

const db = {} as never

describe('resolveThreadModel', () => {
  it('returns the model when the installation has one', async () => {
    getDefaultModelForThread.mockResolvedValue({ id: 'm1' })
    expect(await resolveThreadModel(db, 't1')).toEqual({ id: 'm1' } as never)
  })

  it('returns null for an empty catalog instead of throwing', async () => {
    getDefaultModelForThread.mockRejectedValue(new Error('No system model found'))
    expect(await resolveThreadModel(db, 't1')).toBeNull()
  })

  it('still throws on any other failure — a broken database is not an empty catalog', async () => {
    getDefaultModelForThread.mockRejectedValue(new Error('database is locked'))
    await expect(resolveThreadModel(db, 't1')).rejects.toThrow('database is locked')
  })
})
