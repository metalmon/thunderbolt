import { beforeEach, describe, expect, it } from 'bun:test'

import { localSettingsStorageName, migrateLocalSettingsKey } from './local-settings-key'

const legacyName = 'thunderbolt-local-settings'

const makeStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
  } as Storage
}

describe('migrateLocalSettingsKey', () => {
  let saved: string

  beforeEach(() => {
    saved = JSON.stringify({ state: { cloudUrl: 'https://backend.example/v1' }, version: 0 })
  })

  it('moves the upstream-named entry across and removes it', () => {
    const storage = makeStorage({ [legacyName]: saved })
    migrateLocalSettingsKey(storage)
    expect(storage.getItem(localSettingsStorageName)).toBe(saved)
    expect(storage.getItem(legacyName)).toBeNull()
  })

  it('leaves an existing entry alone — a later run must not overwrite newer settings', () => {
    const current = JSON.stringify({ state: { cloudUrl: 'https://new.example/v1' }, version: 0 })
    const storage = makeStorage({ [localSettingsStorageName]: current, [legacyName]: saved })
    migrateLocalSettingsKey(storage)
    expect(storage.getItem(localSettingsStorageName)).toBe(current)
  })

  it('does nothing when there is nothing to move', () => {
    const storage = makeStorage()
    migrateLocalSettingsKey(storage)
    expect(storage.getItem(localSettingsStorageName)).toBeNull()
  })

  it('survives storage that throws, so a private-mode boot is not a crash', () => {
    const throwing = {
      getItem: () => {
        throw new Error('SecurityError')
      },
    } as unknown as Storage
    expect(() => migrateLocalSettingsKey(throwing)).not.toThrow()
  })

  it('is a no-op without storage at all', () => {
    expect(() => migrateLocalSettingsKey(undefined)).not.toThrow()
  })
})
