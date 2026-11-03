/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import {
  getCurrentAgentOwner,
  getCurrentOwnerIsAnonymous,
  localAgentOwnerId,
  resolveAgentOwner,
  setCurrentAgentOwner,
  setCurrentOwnerIsAnonymous,
} from './agent-owner'

describe('resolveAgentOwner', () => {
  it('names the device mark when autonomous and there is no session', () => {
    expect(resolveAgentOwner(null, true)).toBe(localAgentOwnerId)
    expect(resolveAgentOwner(undefined, true)).toBe(localAgentOwnerId)
  })

  it('leaves the owner empty in server mode without a session', () => {
    // Upstream behaviour must not shift: before sign-in there are no custom agents.
    expect(resolveAgentOwner(null, false)).toBeNull()
  })

  it('lets a session id win in either mode', () => {
    expect(resolveAgentOwner('user-1', false)).toBe('user-1')
    expect(resolveAgentOwner('user-1', true)).toBe('user-1')
  })

  it('keeps the mark unable to collide with a Better Auth id', () => {
    // The colon is the guarantee — a generated user id has none.
    expect(localAgentOwnerId).toContain(':')
  })
})

// ⚠ Asserts transitions, never an initial value. The store is a module singleton and
// seven suites on the assembled tree write to it, so "defaults to false" is unprovable
// in a shared process — it passed alone here and failed in the full run. The default
// itself is the initializer in the module; what is worth proving is that each fact
// survives the other being written.
describe('the published owner store', () => {
  it('carries both facts independently', () => {
    // Both come from one store so the management gate and the row scope can never read
    // different answers to "who am I".
    setCurrentOwnerIsAnonymous(false)
    setCurrentAgentOwner('user-1')
    expect(getCurrentAgentOwner()).toBe('user-1')
    expect(getCurrentOwnerIsAnonymous()).toBe(false)

    setCurrentOwnerIsAnonymous(true)
    expect(getCurrentOwnerIsAnonymous()).toBe(true)
    expect(getCurrentAgentOwner()).toBe('user-1')

    setCurrentAgentOwner('user-2')
    expect(getCurrentOwnerIsAnonymous()).toBe(true)

    setCurrentAgentOwner(null)
    setCurrentOwnerIsAnonymous(false)
  })
})
