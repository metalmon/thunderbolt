/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getAllModels, getAvailableModels } from '@/dal/models'
import { setupTestDatabase, teardownTestDatabase } from '@/dal/test-utils'
import { getDb } from '@/db/database'
import { modelsTable } from '@/db/tables'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import type { Model } from '@/types'

const setMode = (operationMode: 'server' | 'local') => useLocalSettingsStore.setState({ operationMode })

const row = (id: string, provider: Model['provider'], isSystem: 0 | 1) => ({
  id,
  name: id,
  provider,
  modelId: id,
  isSystem,
  enabled: 1 as const,
})

beforeAll(async () => {
  await setupTestDatabase()
})

afterAll(async () => {
  await teardownTestDatabase()
})

beforeEach(async () => {
  const db = getDb()
  await db.delete(modelsTable)
  await db.insert(modelsTable).values([
    // Our backend holds the key for these two: they are the paid lane.
    row('ours-thunderbolt', 'thunderbolt', 1),
    row('ours-managed', 'managed', 1),
    // Reached as `<cloudUrl>/tinfoil` with our key injected by the backend.
    row('ours-tinfoil-system', 'tinfoil', 1),
    // The user's own Tinfoil account — their key, not ours.
    row('byok-tinfoil', 'tinfoil', 0),
    // Plain BYOK, direct from the desktop app.
    row('byok-openai', 'openai', 0),
  ])
})

afterEach(() => {
  setMode(initialLocalSettings.operationMode)
})

const ids = async (query: { execute: () => Promise<unknown> }) => {
  const rows = (await (query as unknown as Promise<Model[]>)) ?? []
  return rows.map((m) => m.id).sort()
}

describe('local mode hides the model lanes keyed on our backend', () => {
  it('keeps every lane in server mode', async () => {
    setMode('server')
    expect(await ids(getAvailableModels(getDb()))).toEqual([
      'byok-openai',
      'byok-tinfoil',
      'ours-managed',
      'ours-thunderbolt',
      'ours-tinfoil-system',
    ])
  })

  // "Hide, don't break": the rows stay in the database (switching back to server
  // mode must restore them), they are only absent from what the user is offered.
  it('offers only the user-keyed lanes in local mode', async () => {
    setMode('local')
    expect(await ids(getAvailableModels(getDb()))).toEqual(['byok-openai', 'byok-tinfoil'])
  })

  // The settings list too, not just the picker — a model shown in Settings that
  // cannot answer is the same broken promise.
  it('hides them from the settings list as well', async () => {
    setMode('local')
    expect(await ids(getAllModels(getDb()))).toEqual(['byok-openai', 'byok-tinfoil'])
  })

  // The user's own Tinfoil key does not go through us, so it survives. This is
  // the lane/capability distinction: `tinfoil` as a provider is not the problem,
  // a tinfoil row whose key lives on our server is.
  it('keeps a user-keyed tinfoil model while dropping the system one', async () => {
    setMode('local')
    const offered = await ids(getAvailableModels(getDb()))
    expect(offered).toContain('byok-tinfoil')
    expect(offered).not.toContain('ours-tinfoil-system')
  })
})
