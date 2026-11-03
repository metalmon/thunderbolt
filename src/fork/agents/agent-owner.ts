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

/**
 * The owner stamped on custom-agent rows created in autonomous mode.
 *
 * `agents.user_id` is the schema's only `notNull()` owner column — the other twelve
 * synced tables leave it empty and let the server stamp it on upload — and autonomous
 * mode has no session to name. Without a stand-in a custom agent cannot be created
 * there at all, which is the defect this fixes. A constant mark keeps upstream's "an
 * agent always has an owner" invariant and lets `ownedBy` stay a plain comparison
 * instead of growing a special case.
 *
 * The colon is load-bearing: Better Auth's user ids contain none, so this value can
 * never collide with a real owner, by accident or by guessing. A collision would mean
 * another account's agent reading as this device's.
 *
 * See `docs/development/local-mode-agent-ownership.md`.
 */
export const localAgentOwnerId = 'volt:local-device'

/**
 * Who owns this device's custom-agent rows: the session user when there is one, the
 * device mark when running autonomously, nobody otherwise.
 *
 * A session id always wins, so a deployment with a backend is unchanged — before
 * sign-in there is still no owner and still no custom agents.
 *
 * `localMode` is a parameter rather than an `isLocalMode()` call inside, so the one
 * publisher states which mode it is publishing for and the test needs no module mock
 * (which in bun is process-wide and never undone).
 */
export const resolveAgentOwner = (sessionUserId: string | null | undefined, localMode: boolean): string | null =>
  sessionUserId ?? (localMode ? localAgentOwnerId : null)

let currentOwner: string | null = null
let ownerIsAnonymous = false
const listeners = new Set<() => void>()

const announce = () => {
  for (const listener of listeners) {
    listener()
  }
}

export const setCurrentAgentOwner = (ownerId: string | null): void => {
  if (ownerId === currentOwner) {
    return
  }
  currentOwner = ownerId
  announce()
}

/**
 * Whether the published owner is an anonymous account, published here rather than read
 * from the session at each use.
 *
 * This is the same "one answer to who am I" rule as the owner itself, and it is not
 * theoretical: the management gate used to read `session.user.isAnonymous` through a
 * local the owner-seam change removes, so the two lived on different patch branches and
 * collided on every rebuild. Reading both facts from one store ends that.
 */
export const setCurrentOwnerIsAnonymous = (isAnonymous: boolean): void => {
  if (isAnonymous === ownerIsAnonymous) {
    return
  }
  ownerIsAnonymous = isAnonymous
  announce()
}

export const getCurrentAgentOwner = (): string | null => currentOwner

export const getCurrentOwnerIsAnonymous = (): boolean => ownerIsAnonymous

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useCurrentAgentOwner = (): string | null =>
  useSyncExternalStore(subscribe, getCurrentAgentOwner, getCurrentAgentOwner)

export const useCurrentOwnerIsAnonymous = (): boolean =>
  useSyncExternalStore(subscribe, getCurrentOwnerIsAnonymous, getCurrentOwnerIsAnonymous)
