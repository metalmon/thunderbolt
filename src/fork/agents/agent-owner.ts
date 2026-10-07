/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork IP — additive. Not upstream MPL logic; a thin fork-only helper. */

/**
 * Who the custom-agent rows on this device belong to right now: the signed-in
 * session's user id, or null while there is no session.
 *
 * The local SQLite database outlives sign-outs ("keep data on device") and the
 * `agents` rows it holds carry the id of whoever created them, so on a shared
 * device another user's agents — and the pairing tokens next to them — are
 * still on disk. Every read, write and token lookup of a custom agent is scoped
 * to this owner, so a row that is not the current user's is invisible and
 * unusable, not merely unmanageable.
 *
 * `useBootstrapSystemAgents` in `app.tsx` keeps this in step with the session.
 * Non-React code (chat hydration, the ACP transport) reads the getter; hooks
 * subscribe through `useCurrentAgentOwner`.
 */
import { useSyncExternalStore } from 'react'

let currentOwner: string | null = null
const listeners = new Set<() => void>()

export const setCurrentAgentOwner = (ownerId: string | null): void => {
  if (ownerId === currentOwner) {
    return
  }
  currentOwner = ownerId
  for (const listener of listeners) {
    listener()
  }
}

export const getCurrentAgentOwner = (): string | null => currentOwner

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useCurrentAgentOwner = (): string | null =>
  useSyncExternalStore(subscribe, getCurrentAgentOwner, getCurrentAgentOwner)
