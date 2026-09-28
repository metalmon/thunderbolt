/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork: the local database is named after the product, so it is `volt-sync.db`
 * rather than upstream's `thunderbolt-sync.db` — and installs that predate the
 * rename have to keep their data.
 *
 * Where the file actually lives: `getDatabasePath` hands wa-sqlite a path whose
 * directory is discarded (`src/db/powersync/database.ts` keeps only the
 * basename), so the database is an OPFS entry in the webview's own storage, not
 * a file in the app data directory. On desktop that storage belongs to the
 * bundle identifier, so the name is cosmetic — which is exactly why the
 * migration must not be able to lose anything: it renames, and on the slightest
 * doubt keeps using the old name.
 *
 * OPFSCoopSyncVFS opens three entries per database — `<name>`, `<name>-journal`
 * and `<name>-wal` — and SQLite can only recover a hot journal that sits beside
 * its database under the matching name. They therefore move as a group, or not
 * at all.
 */

/** The minimum of an OPFS directory this module needs (and tests can fake). */
export type OpfsDirectory = {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<OpfsFileHandle>
}

/** `move` is Chromium-only; its absence just means "do not migrate". */
export type OpfsFileHandle = {
  move?: (newName: string) => Promise<void>
}

/** Sidecars first, database last: a half-migrated set must never be the state
 *  a reader finds, and the database is the entry other tabs hold open. */
const relatedSuffixes = ['-journal', '-wal', ''] as const

const exists = async (root: OpfsDirectory, name: string): Promise<boolean> => {
  try {
    await root.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

const move = async (root: OpfsDirectory, from: string, to: string): Promise<void> => {
  const handle = await root.getFileHandle(from)
  if (!handle.move) {
    throw new Error('OPFS handles cannot be renamed in this runtime')
  }
  await handle.move(to)
}

/**
 * Renames `legacy` and its sidecars to `next`. Returns false — having undone
 * whatever it managed — when any entry refuses to move, which is what happens
 * while another tab holds the database open.
 */
const migrate = async (root: OpfsDirectory, legacy: string, next: string): Promise<boolean> => {
  const moved: string[] = []
  try {
    for (const suffix of relatedSuffixes) {
      if (await exists(root, `${legacy}${suffix}`)) {
        await move(root, `${legacy}${suffix}`, `${next}${suffix}`)
        moved.push(suffix)
      }
    }
    return true
  } catch (error) {
    console.warn('[db] keeping the previous database name — migration could not complete', error)
    for (const suffix of moved) {
      try {
        await move(root, `${next}${suffix}`, `${legacy}${suffix}`)
      } catch (rollbackError) {
        // Nothing better is available: report loudly and still return false, so
        // the caller opens the old name — which is where the database itself is
        // unless it was the entry that moved, and that one moves last.
        console.error('[db] failed to undo a partial database rename', suffix, rollbackError)
      }
    }
    return false
  }
}

/** Upstream's names, still in use by anyone who installed before the rename. */
const legacyNames = { powersync: 'thunderbolt-sync.db', plain: 'thunderbolt.db' } as const

/** The fork's names. */
export const databaseNames = { powersync: 'volt-sync.db', plain: 'volt.db' } as const

const opfsRoot = async (): Promise<OpfsDirectory | null> => {
  try {
    return (await navigator.storage.getDirectory()) as unknown as OpfsDirectory
  } catch {
    return null
  }
}

/**
 * Seam for `getDatabasePath`: the OPFS basename to open for this database type,
 * migrating a pre-rename database on the way when that is safe.
 */
export const forkDatabaseFilename = async (isPowerSync: boolean): Promise<string> => {
  const key = isPowerSync ? 'powersync' : 'plain'
  return resolveDatabaseFilename({ legacy: legacyNames[key], next: databaseNames[key], root: await opfsRoot() })
}

/**
 * The database filename to open: `next` for fresh installs and for installs
 * already migrated, `legacy` whenever its data is still there and renaming it
 * is not safely possible.
 */
export const resolveDatabaseFilename = async ({
  legacy,
  next,
  root,
}: {
  legacy: string
  next: string
  root: OpfsDirectory | null
}): Promise<string> => {
  if (!root) {
    return next
  }
  if (await exists(root, next)) {
    return next
  }
  if (!(await exists(root, legacy))) {
    return next
  }
  return (await migrate(root, legacy, next)) ? next : legacy
}
