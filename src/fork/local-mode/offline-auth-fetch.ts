/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const jsonHeaders = { 'content-type': 'application/json' }

/**
 * What Better Auth's `customFetchImpl` accepts.
 *
 * Deliberately not `typeof fetch`: Bun's global declares a `preconnect` member
 * that the DOM lib does not, so claiming that type forces a stub nobody calls.
 * `src/lib/proxy-fetch.ts` writes out the same reasoning for `FetchFn`.
 */
type AuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * The auth client's transport on an install that has no auth server.
 *
 * ⚠ Why this exists: four components call Better Auth's `useSession`, and each
 * one fetches `/api/auth/get-session` on mount. In local mode there is no
 * backend, so every boot spent three refused requests on a host that is not
 * there — the last of the leaks the autonomous-mode inventory named. Not fatal,
 * but in a closed perimeter a refused connection is not always the fast answer,
 * and a console full of failures hides the ones that matter.
 *
 * Nothing about the auth client's shape changes: the callers keep asking, they
 * just get the truthful answer without a network round trip.
 *
 * - `get-session` answers `null` — the honest reply, since local mode has no
 *   account by design, and exactly what Better Auth reads as "signed out".
 * - everything else answers 503. A sign-in attempt here is not a failure to
 *   retry, it is a thing this install cannot do; saying so beats a silent
 *   success that leaves the caller waiting for a session that never arrives.
 */
export const createOfflineAuthFetch =
  (): AuthFetch =>
  async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('get-session')) {
      return new Response('null', { status: 200, headers: jsonHeaders })
    }
    return new Response(JSON.stringify({ message: 'This installation runs without an authentication server.' }), {
      status: 503,
      headers: jsonHeaders,
    })
  }
