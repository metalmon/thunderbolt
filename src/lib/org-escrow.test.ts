/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { pinnedOrgEscrowPublicKey } from './org-escrow'

const env = import.meta.env as Record<string, unknown>

/**
 * ⚠ Fork: restoring by ASSIGNMENT is what broke the suite.
 *
 * Under bun `import.meta.env` is `process.env`, and assigning `undefined` to it
 * stores the STRING "undefined". That value then outlives this file — it is
 * process state, not module state — so every later test saw a pinned escrow key
 * of `"undefined"`, `buildOrgEnvelope` believed this build escrows, and
 * `atob("undefined")` threw `InvalidCharacterError`. It cost 37 failures in
 * `src/services/encryption.test.ts` that have nothing to do with encryption,
 * and the count moved between runs because `--randomize` decides whether this
 * file runs first.
 *
 * `delete` is the only way to put the variable back to genuinely unset.
 */
const restore = (value: unknown) => {
  if (value === undefined) {
    delete env.VITE_ORG_ESCROW_PUBLIC_KEY
    return
  }
  env.VITE_ORG_ESCROW_PUBLIC_KEY = value
}

describe('pinnedOrgEscrowPublicKey', () => {
  let saved: unknown

  beforeEach(() => {
    saved = env.VITE_ORG_ESCROW_PUBLIC_KEY
  })

  afterEach(() => {
    restore(saved)
  })

  it('returns the pinned key when set', () => {
    env.VITE_ORG_ESCROW_PUBLIC_KEY = 'BNPkxi77YSUg'
    expect(pinnedOrgEscrowPublicKey()).toBe('BNPkxi77YSUg')
  })

  it('trims surrounding whitespace a build pipeline may introduce', () => {
    env.VITE_ORG_ESCROW_PUBLIC_KEY = '  BNPkxi77YSUg\n'
    expect(pinnedOrgEscrowPublicKey()).toBe('BNPkxi77YSUg')
  })

  // Unset / blank must read as "this build escrows nothing" rather than as an
  // empty pin: `buildOrgEnvelope` branches on undefined and would otherwise hand
  // an empty string to importOrgPublicKey.
  it('returns undefined when unset', () => {
    restore(undefined)
    expect(pinnedOrgEscrowPublicKey()).toBeUndefined()
  })

  it('returns undefined for an empty or whitespace-only value', () => {
    env.VITE_ORG_ESCROW_PUBLIC_KEY = ''
    expect(pinnedOrgEscrowPublicKey()).toBeUndefined()
    env.VITE_ORG_ESCROW_PUBLIC_KEY = '   '
    expect(pinnedOrgEscrowPublicKey()).toBeUndefined()
  })
})
