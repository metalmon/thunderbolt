/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, mock } from 'bun:test'
import { databaseNames, resolveDatabaseFilename, type OpfsDirectory } from './database-filename'

/**
 * Fake OPFS root holding just the entry names, which is all the migration
 * reasons about. `failMove` makes a named entry refuse to be renamed — the way
 * a real handle throws when another tab holds a sync access handle on it.
 */
const fakeRoot = (names: string[], failMove?: string) => {
  const entries = new Set(names)
  const moves: string[] = []
  const root: OpfsDirectory = {
    getFileHandle: async (name, options) => {
      if (!entries.has(name)) {
        if (!options?.create) {
          throw new DOMException(`no entry ${name}`, 'NotFoundError')
        }
        entries.add(name)
      }
      return {
        move: async (newName: string) => {
          if (name === failMove) {
            throw new DOMException('locked', 'NoModificationAllowedError')
          }
          entries.delete(name)
          entries.add(newName)
          moves.push(`${name} -> ${newName}`)
        },
      }
    },
  }
  return { root, entries, moves }
}

const legacy = 'thunderbolt-sync.db'
const next = databaseNames.powersync

describe('resolveDatabaseFilename', () => {
  it('uses the new name on a fresh install and moves nothing', async () => {
    const { root, moves } = fakeRoot([])

    expect(await resolveDatabaseFilename({ legacy, next, root })).toBe(next)
    expect(moves).toEqual([])
  })

  it('uses the new name when it is already there, without touching a legacy leftover', async () => {
    const { root, moves, entries } = fakeRoot([next, legacy])

    expect(await resolveDatabaseFilename({ legacy, next, root })).toBe(next)
    expect(moves).toEqual([])
    // The stale legacy database is left alone rather than deleted — that is the
    // user's data, and nothing here is qualified to decide it is disposable.
    expect(entries.has(legacy)).toBe(true)
  })

  it('renames the database with its journal and wal, main file last', async () => {
    const { root, moves, entries } = fakeRoot([legacy, `${legacy}-journal`, `${legacy}-wal`])

    expect(await resolveDatabaseFilename({ legacy, next, root })).toBe(next)
    expect(moves).toEqual([
      `${legacy}-journal -> ${next}-journal`,
      `${legacy}-wal -> ${next}-wal`,
      `${legacy} -> ${next}`,
    ])
    expect(entries.has(next)).toBe(true)
    expect(entries.has(legacy)).toBe(false)
  })

  it('migrates a database whose sidecars are absent', async () => {
    const { root, moves } = fakeRoot([legacy])

    expect(await resolveDatabaseFilename({ legacy, next, root })).toBe(next)
    expect(moves).toEqual([`${legacy} -> ${next}`])
  })

  it('rolls back and keeps using the old name when the database itself cannot move', async () => {
    const { root, moves, entries } = fakeRoot([legacy, `${legacy}-journal`, `${legacy}-wal`], legacy)

    // A locked database (another tab has it open) must not leave the journal
    // and wal stranded under the new name — SQLite would no longer find them.
    expect(await resolveDatabaseFilename({ legacy, next, root })).toBe(legacy)
    expect(moves.slice(-2)).toEqual([`${next}-journal -> ${legacy}-journal`, `${next}-wal -> ${legacy}-wal`])
    expect(entries.has(legacy)).toBe(true)
    expect(entries.has(`${legacy}-journal`)).toBe(true)
    expect(entries.has(`${legacy}-wal`)).toBe(true)
    expect(entries.has(next)).toBe(false)
  })

  it('keeps using the old name when a sidecar cannot move', async () => {
    const { root, entries } = fakeRoot([legacy, `${legacy}-wal`], `${legacy}-wal`)

    expect(await resolveDatabaseFilename({ legacy, next, root })).toBe(legacy)
    expect(entries.has(legacy)).toBe(true)
    expect(entries.has(next)).toBe(false)
  })

  it('falls back to the old name when the runtime has no move() at all', async () => {
    const root: OpfsDirectory = {
      getFileHandle: async (name) => {
        if (name !== legacy) {
          throw new DOMException(`no entry ${name}`, 'NotFoundError')
        }
        return {}
      },
    }

    expect(await resolveDatabaseFilename({ legacy, next, root })).toBe(legacy)
  })

  it('uses the new name when OPFS is not reachable at all', async () => {
    const root = mock(async () => null)

    expect(await resolveDatabaseFilename({ legacy, next, root: await root() })).toBe(next)
  })
})

describe('databaseNames', () => {
  it('names the databases after the product', () => {
    expect(databaseNames).toEqual({ powersync: 'volt-sync.db', plain: 'volt.db' })
  })
})
