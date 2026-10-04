/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { createVoltdRelayRoutes, exceedsQueueBudget } from './relay'
import type { Auth } from '@/auth/elysia-plugin'
import type { VoltdTokenService } from './token'

describe('exceedsQueueBudget', () => {
  it('allows a frame that fits both budgets', () => {
    expect(exceedsQueueBudget(0, 0, 'hello')).toBe(false)
    expect(exceedsQueueBudget(63, 1024, 'hello')).toBe(false)
  })

  it('rejects the frame that would exceed the message count', () => {
    expect(exceedsQueueBudget(64, 0, 'x')).toBe(true)
  })

  it('rejects the frame that would exceed the byte budget', () => {
    expect(exceedsQueueBudget(0, 256 * 1024, 'x')).toBe(true)
  })

  it('measures binary frames by byte length, not character count', () => {
    expect(exceedsQueueBudget(0, 256 * 1024 - 4, new Uint8Array(8))).toBe(true)
    expect(exceedsQueueBudget(0, 256 * 1024 - 16, new Uint8Array(8))).toBe(false)
  })

  it('measures strings in UTF-8 bytes, so multi-byte text is not undercounted', () => {
    // Four Cyrillic characters are eight bytes, not four.
    expect(exceedsQueueBudget(0, 256 * 1024 - 5, 'тест')).toBe(true)
  })
})

const service = (): VoltdTokenService => ({
  issuer: 'https://backend.volt.example/v1',
  audience: 'volt',
  ttlSeconds: 900,
  jwks: { keys: [] },
  mint: async () => 'minted',
})

const auth = {} as Auth

describe('createVoltdRelayRoutes', () => {
  it('mounts nothing without a gateway, so the route cannot dial an unset target', () => {
    const routes = createVoltdRelayRoutes({ auth, service: service(), gatewayUrl: '' })
    expect(routes.routes).toHaveLength(0)
  })

  it('mounts nothing for a cleartext gateway outside loopback', () => {
    const routes = createVoltdRelayRoutes({ auth, service: service(), gatewayUrl: 'ws://gateway.internal/acp' })
    expect(routes.routes).toHaveLength(0)
  })

  it('mounts the relay for a wss gateway', () => {
    const routes = createVoltdRelayRoutes({ auth, service: service(), gatewayUrl: 'wss://gateway.internal/acp' })
    expect(routes.routes.length).toBeGreaterThan(0)
  })
})
