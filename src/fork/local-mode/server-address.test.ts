/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { verifyServerAddress } from './server-address'

describe('verifyServerAddress', () => {
  it('accepts https and reports the host for the user to read back', () => {
    expect(verifyServerAddress('https://backend.example.ru/v1')).toEqual({
      ok: true,
      url: 'https://backend.example.ru/v1',
      host: 'backend.example.ru',
    })
  })

  // Plain HTTP on a real network would put the bearer token on the wire.
  it('refuses plain http off the loopback', () => {
    expect(verifyServerAddress('http://backend.example.ru/v1')).toEqual({ ok: false, reason: 'insecure-scheme' })
  })

  // ...but the loopback is how the app is developed and how a local backend is
  // reached, so it stays allowed.
  it.each(['http://localhost:8000/v1', 'http://127.0.0.1:8000/v1', 'http://[::1]:8000/v1'])(
    'allows the loopback over http (%s)',
    (url) => {
      expect(verifyServerAddress(url).ok).toBe(true)
    },
  )

  // Anything that is not an http(s) URL must never be tried at all.
  it.each(['file:///etc/passwd', 'javascript:fetch("/steal")', 'ws://backend.example.ru'])(
    'refuses the scheme %s',
    (url) => {
      expect(verifyServerAddress(url)).toEqual({ ok: false, reason: 'insecure-scheme' })
    },
  )

  it('reports an unparseable value as such, not as a scheme problem', () => {
    expect(verifyServerAddress('backend.example.ru/v1')).toEqual({ ok: false, reason: 'unparseable' })
    expect(verifyServerAddress('   ')).toEqual({ ok: false, reason: 'empty' })
  })
})
