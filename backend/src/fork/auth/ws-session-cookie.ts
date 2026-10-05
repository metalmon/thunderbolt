/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Auth } from '@/auth/auth'
import type { User } from '@shared/types/auth'

/**
 * Authorise a WebSocket upgrade by the session cookie the browser already sent.
 *
 * The agent relay authenticates by a bearer offered on a subprotocol, and the desktop
 * client has one: its SSO flow returns a token through the loopback and stores it. The
 * WEB client never gets one — its SSO ends in a browser redirect that sets a session
 * cookie, and nothing in that path produces a bearer. So every agent turn from the web
 * was closed with 4001 `unauthorized` while the same account worked everywhere else.
 *
 * A WebSocket upgrade to our own origin carries that cookie, so the session is right
 * there; it just was not being read.
 *
 * `Origin` is checked because cookies ride along on a cross-site WebSocket too — unlike
 * fetch, the browser does not withhold them and there is no preflight. Without this check
 * any page could open an agent session as whoever is signed in here.
 *
 * @param auth - the Better Auth instance
 * @param headers - the upgrade request's headers
 * @param allowedOrigins - origins permitted to open a session (the deployment's own)
 * @returns the signed-in user, or null when the request carries no usable session
 */
export const authorizeWsSessionCookie = async (
  auth: Auth,
  headers: Headers,
  allowedOrigins: readonly string[],
): Promise<User | null> => {
  const cookie = headers.get('cookie')
  if (!cookie) return null

  const origin = headers.get('origin')
  // A same-origin upgrade from a non-browser client may carry no Origin at all; a browser
  // always sends one, so only a PRESENT and unknown origin is a refusal.
  if (origin && !allowedOrigins.includes(origin)) return null

  const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
  const user = session?.user as User | undefined
  if (!user || user.isAnonymous) return null
  return user
}
