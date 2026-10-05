/**
 * The localStorage key the local-settings store persists under, and the one-time move
 * off the upstream name.
 *
 * The key is not a label — it is the address of real data, `cloudUrl` among it, which is
 * how an installed client remembers which backend it talks to. Renaming it without
 * moving the contents would silently reset every local setting on upgrade, so the two
 * are the same change.
 */

const legacyName = 'thunderbolt-local-settings'

/** Key for `persist`. Read by `src/stores/local-settings-store.ts`. */
export const localSettingsStorageName = 'volt-local-settings'

/**
 * Copy the upstream-named entry to ours, once, before the store reads it.
 *
 * Deliberately not zustand's `migrate`: that runs on the value under a single key and
 * cannot see one written under a different name. Called at module scope from the store
 * so it is ordered ahead of `persist`'s own first read.
 *
 * Silent on failure on purpose — Safari in private mode throws on `localStorage` access,
 * and losing local preferences is not worth failing a boot over.
 */
export const migrateLocalSettingsKey = (storage: Storage | undefined = globalThis.localStorage) => {
  if (!storage) return
  try {
    if (storage.getItem(localSettingsStorageName) !== null) return
    const legacy = storage.getItem(legacyName)
    if (legacy === null) return
    storage.setItem(localSettingsStorageName, legacy)
    storage.removeItem(legacyName)
  } catch {
    // no storage, or no permission to use it
  }
}
