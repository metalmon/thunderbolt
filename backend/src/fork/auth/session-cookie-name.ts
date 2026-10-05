/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Which cookie carries Better Auth's session on this deployment.
 *
 * Better Auth turns on secure cookies by itself when the base URL is https, and a secure
 * cookie is named with the `__Secure-` prefix. Code that looks only for the bare name
 * therefore finds nothing on every TLS deployment — which is how desktop sign-in came
 * back "Session not found" on the pilot while working on an http dev stand.
 *
 * Both names are offered, prefixed first: a request can legitimately carry only one, and
 * on a mixed upgrade (a browser holding an old bare cookie against a now-https backend)
 * the prefixed one is the current session.
 */

/** Better Auth's cookie name without the security prefix. */
export const baseSessionCookieName = 'better-auth.session_token'

/** The same cookie as issued over TLS. */
export const secureSessionCookieName = `__Secure-${baseSessionCookieName}`

/**
 * Names to try, in order, when reading the session cookie out of a request.
 *
 * @returns the prefixed name first, then the bare one
 */
export const sessionCookieNames = (): readonly string[] => [secureSessionCookieName, baseSessionCookieName]

/**
 * Read the session token from a Cookie header, whichever name it arrived under.
 *
 * @param cookieHeader - the raw `Cookie` request header
 * @param read - reads one named value out of that header (the caller's own parser)
 * @returns the first value found, or undefined when the request carries no session
 */
export const readSessionCookie = (
  cookieHeader: string,
  read: (header: string, name: string) => string | undefined,
): string | undefined => {
  for (const name of sessionCookieNames()) {
    const value = read(cookieHeader, name)
    if (value) return value
  }
  return undefined
}
