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
 * - **`mapping.extraFields` is how the claim gets here at all, and it is not
 *   optional.** The plugin builds the `userInfo` it passes on from five fields —
 *   `{id, email, emailVerified, name, image}` — plus whatever `extraFields` names,
 *   and it does that in BOTH branches: from the UserInfo endpoint when the provider
 *   advertises one (Keycloak does, so this is the live path) and from the verified
 *   `id_token` otherwise. Every other claim is dropped before this callback runs.
 *   An earlier version of this comment claimed the opposite and the column silently
 *   stayed empty: the sign-in succeeded, `userInfo` carried only those five names,
 *   and no agent was ever published. `voltdGroupsExtraFields` below is what the
 *   call site must pass; the `claim names offered by the identity provider` log line
 *   is the diagnostic that catches it next time.
 *
 * **Only the operator's own identity provider is trusted.** Better Auth's
 * `/sso/register` endpoint is gated by `sessionMiddleware` alone, so without the
 * `providersLimit: 0` set at the call site any signed-in user could register an
 * OIDC provider they control, sign in through it, and have it assert
 * `groups: ["volt-admins"]` — a complete authorization bypass, since this column
 * is what the gateway's permission profiles key on. The issuer of the provider the
 * sign-in actually came through is therefore checked against the configured one,
 * and anything else clears the column instead of filling it. Two independent
 * controls, because one of them lives in an upstream file that a future rebase
 * could quietly drop.
 *
 * The claim is addressed by a **dotted path** (`VOLTD_GROUPS_CLAIM`, default
 * `groups`), mirroring the gateway's own `claim_path`, because the identity
 * provider is not known in advance: Keycloak's Group Membership mapper emits
 * `groups`, its realm roles live at `realm_access.roles`, and other providers
 * differ again.
 */

import { createStandaloneLogger } from '@/config/logger'
import { getSettings, type Settings } from '@/config/settings'
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
  /** The provider the sign-in came through. `issuer` is on `BaseSSOProvider`. */
  provider?: { issuer?: unknown; providerId?: unknown }
}

export type ProvisionVoltdGroupsOptions = {
  database: QueryableDatabase
  /** Defaults to the app's standalone logger, built lazily so importing this
   *  module does not read settings. */
  logger?: GroupsLogger
  /** Test seam — production reads `VOLTD_GROUPS_CLAIM`. */
  claimPath?: string
  /** Issuers whose group claims may be trusted. Production derives them from the
   *  deployment's own OIDC/SAML configuration. */
  trustedIssuers?: readonly string[]
}

/**
 * The issuers this deployment configured itself. A provider whose issuer is not
 * among them was registered by a user, not an operator, and its claims about group
 * membership are worth nothing.
 *
 * @param settings - resolved app settings
 */
export const readTrustedIssuers = (settings: Pick<Settings, 'oidcIssuer' | 'samlIdpIssuer'>): string[] =>
  [settings.oidcIssuer, settings.samlIdpIssuer].map((issuer) => issuer?.trim()).filter((issuer): issuer is string => !!issuer)

/**
 * Resolve the configured claim path.
 *
 * @param env - environment map, defaulting to `process.env`
 */
export const readGroupsClaimPath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.VOLTD_GROUPS_CLAIM?.trim() || defaultGroupsClaimPath

/**
 * The SSO provider's `mapping.extraFields`, so the group claim survives the
 * plugin's five-field rebuild and reaches `provisionUser`. Without this the
 * callback below sees no claim at all and every user ends up with no groups.
 *
 * Keyed on the FIRST segment of the claim path, because `extraFields` copies a
 * top-level claim by name while the path may address a nested one: `groups` copies
 * `groups`, and `realm_access.roles` copies the whole `realm_access` object for the
 * dotted reader to walk into. The target key matches the source so the claim keeps
 * the name the path expects.
 *
 * @param claimPath - dotted claim path, defaulting to the configured one
 */
export const voltdGroupsExtraFields = (claimPath: string = readGroupsClaimPath()): Record<string, string> => {
  const root = claimPath.split('.')[0]?.trim() ?? ''
  return root ? { [root]: root } : {}
}

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
  // getSettings() is memoized per process, so resolving it twice costs nothing and
  // keeps each default independent of whether the other was injected.
  const logger = options.logger ?? createStandaloneLogger(getSettings())
  const trustedIssuers = options.trustedIssuers ?? readTrustedIssuers(getSettings())

  return async ({ user: ssoUser, userInfo, provider }: ProvisionArgs): Promise<void> => {
    try {
      const issuer = typeof provider?.issuer === 'string' ? provider.issuer : ''
      if (!trustedIssuers.includes(issuer)) {
        // A provider this deployment did not configure. Clear rather than leave
        // standing: the configured IdP is the only authority on membership, and a
        // sign-in through anything else must not preserve what it once granted.
        logger.warn(
          { userId: ssoUser?.id, providerId: provider?.providerId },
          'voltd groups: sign-in through an unconfigured provider; groups cleared',
        )
        await options.database.update(user).set({ groups: [] }).where(eq(user.id, ssoUser.id))
        return
      }

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
