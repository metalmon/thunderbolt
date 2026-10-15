/* Copyright (c) Okta Plus. All rights reserved. */

import { describe, expect, it } from 'bun:test'

import { HttpError } from '@/lib/http'

import { isRegistryAbsent } from './registry-absent'

const failedWith = (status: number): HttpError => new HttpError(new Response('nope', { status }))

describe('isRegistryAbsent', () => {
  it('reads a 404 as a backend that has no mini apps', () => {
    expect(isRegistryAbsent(failedWith(404))).toBe(true)
  })

  it('keeps every other failure a failure', () => {
    // 502 is the one that matters: a gateway blip must stay retryable, and the
    // caller must go on telling "we do not know" apart from "there are none".
    expect([500, 502, 503, 400, 401].map(failedWith).map(isRegistryAbsent)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('is not fooled by a timeout, an unreadable body, or nothing at all', () => {
    expect(isRegistryAbsent(new Error('GET /mini-apps did not answer with { apps: [...] }'))).toBe(false)
    expect(isRegistryAbsent(new DOMException('aborted', 'TimeoutError'))).toBe(false)
    expect(isRegistryAbsent(undefined)).toBe(false)
  })
})
