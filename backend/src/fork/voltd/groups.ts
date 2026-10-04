/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Copies a user's identity-provider group membership onto `user.groups` at every
 * SSO sign-in. That column is what `token.ts` asserts in the token a voltd gateway
 * authorizes against, so this is the one place group membership enters the system.
 *
 * Design: docs/superpowers/specs/2026-10-04-user-groups-provisioning-design.md.
 * Two properties of the Better Auth SSO plugin shape everything here:
 *
 * - **It awaits this callback before setting the session cookie.** An unhandled
 *   rejection therefore fails the whole SSO callback and the user cannot sign in
 *   *at all* — far worse than having no agents. So nothing escapes: every failure
 *   is logged and swallowed, leaving the session with no groups, which degrades
 *   exactly like the empty-roster case the gateway already handles.
 * - **`mapping.extraFields` cannot do this job.** The plugin rebuilds the object it
 *   hands to the account-linking step from `{email, name, id, image,
 *   emailVerified}` only, so extra claims never reach the database through it.
 *   They survive solely in the `userInfo` passed here.
 *
 * The claim is addressed by a **dotted path** (`VOLTD_GROUPS_CLAIM`, default
 * `groups`), mirroring the gateway's own `claim_path`, because the identity
 * provider is not known in advance: Keycloak's Group Membership mapper emits
 * `groups`, its realm roles live at `realm_access.roles`, and other providers
 * differ again.
 */

import { createStandaloneLogger } from '@/config/logger'
import { getSettings } from '@/config/settings'
import type { QueryableDatabase } from '@/db/client'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'

/** Default claim path. Matches Keycloak's Group Membership mapper and the
 *  gateway's own configured `claim_path` on the pilot. */
export const defaultGroupsClaimPath = 'groups'

/** Minimal logger surface, so callers can pass the app logger or a test double. */
type GroupsLogger = {
  info: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
}

/** The slice of the SSO plugin's `provisionUser` argument this needs. */
export type ProvisionArgs = {
  user: { id: string } & Record<string, unknown>
  userInfo: Record<string, unknown>
}

export type ProvisionVoltdGroupsOptions = {
  database: QueryableDatabase
  /** Defaults to the app's standalone logger, built lazily so importing this
   *  module does not read settings. */
  logger?: GroupsLogger
  /** Test seam — production reads `VOLTD_GROUPS_CLAIM`. */
  claimPath?: string
}

/**
 * Resolve the configured claim path.
 *
 * @param env - environment map, defaulting to `process.env`
 */
export const readGroupsClaimPath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.VOLTD_GROUPS_CLAIM?.trim() || defaultGroupsClaimPath

/**
 * Read a dotted path out of a claim set and normalise it to group names.
 *
 * Anything that is not an array of usable strings yields an empty list rather than
 * throwing: a provider that omits the claim, sends a single string, or nests it
 * differently is a configuration problem to be seen in the logs, not a reason to
 * break the sign-in.
 *
 * @param claims - the provider's claim set (`userInfo`)
 * @param path - dotted path, e.g. `groups` or `realm_access.roles`
 */
export const readGroupsClaim = (claims: Record<string, unknown>, path: string): string[] => {
  const segments = path.split('.').filter((segment) => segment !== '')
  if (segments.length === 0) return []

  let cursor: unknown = claims
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return []
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  if (!Array.isArray(cursor)) return []
  return cursor.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

/** Logged once per process, so an operator who does not know what their provider
 *  emits can read the names off the log and set the path. Names only — the values
 *  are identity data. */
let claimNamesLogged = false

/** Test seam: lets a suite observe the first-run log more than once. */
export const resetClaimNameLoggingForTesting = (): void => {
  claimNamesLogged = false
}

/**
 * Build the `provisionUser` callback. Writes the claim's values to `user.groups`,
 * overwriting rather than merging so a group removed in the provider propagates.
 *
 * @param options - database handle, logger, and the claim-path seam
 */
export const forkProvisionVoltdGroups = (options: ProvisionVoltdGroupsOptions) => {
  const claimPath = options.claimPath ?? readGroupsClaimPath()
  const logger = options.logger ?? createStandaloneLogger(getSettings())

  return async ({ user: ssoUser, userInfo }: ProvisionArgs): Promise<void> => {
    try {
      if (!claimNamesLogged) {
        claimNamesLogged = true
        logger.info(
          { claimPath, claimNames: Object.keys(userInfo ?? {}).sort() },
          'voltd groups: claim names offered by the identity provider',
        )
      }

      const groups = readGroupsClaim(userInfo ?? {}, claimPath)
      const current = Array.isArray(ssoUser.groups) ? (ssoUser.groups as unknown[]) : []
      // Skip the write when nothing changed — this runs on every sign-in.
      if (current.length === groups.length && groups.every((group, index) => current[index] === group)) return

      await options.database.update(user).set({ groups }).where(eq(user.id, ssoUser.id))
    } catch (error) {
      // Never rethrow: the plugin awaits this before the session cookie is set.
      logger.warn({ err: error, userId: ssoUser?.id }, 'voltd groups: provisioning failed; session has none')
    }
  }
}
