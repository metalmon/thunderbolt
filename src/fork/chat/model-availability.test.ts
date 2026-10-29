/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setupTestDatabase, teardownTestDatabase } from '@/dal/test-utils'
import { createTestProvider } from '@/test-utils/test-provider'
import { renderHook, waitFor } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { useModelAvailability } from './model-availability'

// No `mock.module` at all. Both stubs this file used to install — `@/dal` down to
// one export and `@/contexts` down to `useDatabase` — are process-wide in bun and
// never undone, so they broke whichever sibling needed the rest of those modules:
// `selected-model.test.ts` lost `getSelectedModel`, and `visible-steps.test.ts`
// lost `useHttpClient`. The real providers cost one database setup and poison
// nothing.
const getAvailableModels = mock(async () => [] as unknown[])

beforeAll(async () => {
  await setupTestDatabase()
})

afterAll(async () => {
  await teardownTestDatabase()
})

const render = () =>
  renderHook(() => useModelAvailability(getAvailableModels as never), { wrapper: createTestProvider() })

describe('useModelAvailability', () => {
  it('reports none for the empty catalog the fork ships', async () => {
    getAvailableModels.mockResolvedValue([])
    const { result } = render()
    expect(result.current).toBe('checking')
    await waitFor(() => expect(result.current).toBe('none'))
  })

  it('reports present once the operator has added one', async () => {
    getAvailableModels.mockResolvedValue([{ id: 'm1' }])
    const { result } = render()
    await waitFor(() => expect(result.current).toBe('present'))
  })

  // A failed read is not "no models": telling the operator to add one he may
  // already have is worse than staying in the loading state.
  it('stays checking when the read fails — a broken database is not an empty catalog', async () => {
    getAvailableModels.mockRejectedValue(new Error('db gone'))
    const { result } = render()
    await waitFor(() => expect(getAvailableModels).toHaveBeenCalled())
    expect(result.current).toBe('checking')
  })
})
