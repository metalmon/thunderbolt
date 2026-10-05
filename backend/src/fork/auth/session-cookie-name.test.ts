/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'

import { baseSessionCookieName, readSessionCookie, secureSessionCookieName } from './session-cookie-name'

/** The parser the callback route uses, reproduced so the test exercises the real shape. */
const read = (cookieHeader: string, name: string): string | undefined =>
  cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)

describe('readSessionCookie', () => {
  it('finds the prefixed cookie a TLS deployment issues — the pilot case', () => {
    expect(read(`${secureSessionCookieName}=abc.def`, baseSessionCookieName)).toBeUndefined()
    expect(readSessionCookie(`${secureSessionCookieName}=abc.def`, read)).toBe('abc.def')
  })

  it('still finds the bare cookie on an http dev stand', () => {
    expect(readSessionCookie(`${baseSessionCookieName}=abc.def`, read)).toBe('abc.def')
  })

  it('prefers the prefixed cookie when a browser carries both', () => {
    const header = `${baseSessionCookieName}=stale; ${secureSessionCookieName}=current`
    expect(readSessionCookie(header, read)).toBe('current')
  })

  it('is not fooled by a cookie whose name merely ends with the bare name', () => {
    expect(readSessionCookie('not-better-auth.session_token=nope', read)).toBeUndefined()
  })

  it('returns undefined when the request carries no session', () => {
    expect(readSessionCookie('KEYCLOAK_SESSION=x', read)).toBeUndefined()
  })
})
