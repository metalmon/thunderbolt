/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { resolveThreadModel, type ThreadModelReads } from './selected-model'

// No `mock.module`. It is process-wide in bun and never undone, so stubbing the
// `@/dal` barrel down to the two exports this module uses broke the sibling test
// files whenever the directory was run as a whole — and it hid the real problem
// behind "Export named 'getDefaultModelForThread' not found", which names the one
// export that WAS provided. The reads are injected instead.
const getDefaultModelForThread = mock(async () => ({ id: 'm1' }) as never)
const getSelectedModel = mock(async () => ({ id: 'selected' }) as never)
const reads = { getDefaultModelForThread, getSelectedModel } as unknown as ThreadModelReads

const db = {} as never

beforeEach(() => {
  getDefaultModelForThread.mockClear()
  getSelectedModel.mockClear()
})

describe('resolveThreadModel', () => {
  it('returns the model when the installation has one', async () => {
    getDefaultModelForThread.mockResolvedValue({ id: 'm1' } as never)
    expect(await resolveThreadModel(db, 't1', reads)).toEqual({ id: 'm1' } as never)
  })

  // The fork ships an empty catalog on purpose, and upstream's DAL throws rather
  // than returning nothing — so this is the normal state here, not an error.
  it('returns null for an empty catalog instead of throwing', async () => {
    getDefaultModelForThread.mockRejectedValue(new Error('No system model found'))
    expect(await resolveThreadModel(db, 't1', reads)).toBeNull()
  })

  it('still throws on any other failure — a broken database is not an empty catalog', async () => {
    getDefaultModelForThread.mockRejectedValue(new Error('database is locked'))
    await expect(resolveThreadModel(db, 't1', reads)).rejects.toThrow('database is locked')
  })

  // A null thread is a chat that does not exist yet: it resolves through the
  // selected model, not through a thread's default. This is the branch the
  // 0.1.148 sync introduced, and it had no coverage.
  it('resolves a null thread through the selected model', async () => {
    getSelectedModel.mockResolvedValue({ id: 'selected' } as never)
    expect(await resolveThreadModel(db, null, reads)).toEqual({ id: 'selected' } as never)
    expect(getDefaultModelForThread).not.toHaveBeenCalled()
  })

  it('returns null for an empty catalog on the null-thread path too', async () => {
    getSelectedModel.mockRejectedValue(new Error('No system model found'))
    expect(await resolveThreadModel(db, null, reads)).toBeNull()
  })
})
