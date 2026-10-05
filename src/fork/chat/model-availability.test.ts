/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, mock } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'

const getAvailableModels = mock(async () => [] as unknown[])

mock.module('@/contexts', () => ({ useDatabase: () => ({}) }))
mock.module('@/dal', () => ({ getAvailableModels }))

const { useModelAvailability } = await import('./model-availability')

describe('useModelAvailability', () => {
  it('reports none for the empty catalog the fork ships', async () => {
    getAvailableModels.mockResolvedValue([])
    const { result } = renderHook(() => useModelAvailability())
    expect(result.current).toBe('checking')
    await waitFor(() => expect(result.current).toBe('none'))
  })

  it('reports present once the operator has added one', async () => {
    getAvailableModels.mockResolvedValue([{ id: 'm1' }])
    const { result } = renderHook(() => useModelAvailability())
    await waitFor(() => expect(result.current).toBe('present'))
  })

  it('stays checking when the read fails — a broken database is not an empty catalog', async () => {
    getAvailableModels.mockRejectedValue(new Error('db gone'))
    const { result } = renderHook(() => useModelAvailability())
    await waitFor(() => expect(result.current).toBe('checking'))
    expect(result.current).toBe('checking')
  })
})
