/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Settings } from '@/config/settings'
import type { User } from '@shared/types/auth'
import { describe, expect, it } from 'bun:test'
import { createVoltdAgentProvider } from './provider'
import type { VoltdRosterAgent } from './roster'
import type { VoltdTokenService } from './token'

const service = (): VoltdTokenService => ({
  issuer: 'https://backend.volt.example/v1',
  audience: 'volt',
  ttlSeconds: 900,
  jwks: { keys: [] },
  mint: async ({ userId, groups }) => `token-for-${userId}-${groups.join('+')}`,
})

const user = (overrides: Partial<User> & { groups?: string[] } = {}) =>
  ({ id: 'user-1', isAnonymous: false, ...overrides }) as unknown as User

const settings = {} as Settings

const build = (opts: {
  roster?: VoltdRosterAgent[]
  rosterError?: Error
  resolved?: User | null
  gatewayUrl?: string
  onFetch?: (token: string) => void
}) =>
  createVoltdAgentProvider({
    service: service(),
    gatewayUrl: opts.gatewayUrl ?? 'wss://gateway.internal:8443/acp',
    resolveUser: async () => (opts.resolved === undefined ? user() : opts.resolved),
    fetchRoster: async ({ token }) => {
      opts.onFetch?.(token)
      if (opts.rosterError) throw opts.rosterError
      return opts.roster ?? []
    },
  })

const request = () => new Request('https://backend.volt.example/v1/agents')

describe('createVoltdAgentProvider', () => {
  it('is not registered when the deployment names no gateway', () => {
    expect(build({ gatewayUrl: '  ' })).toBeNull()
  })

  // A 200 missing these agents reads as "they are gone" to refreshSystemAgents,
  // which then deletes the local rows. Failing the response instead routes the
  // client into its preserve-on-error path.
  it('is required, so a gateway outage fails discovery instead of emptying it', async () => {
    const provider = build({ rosterError: new Error('gateway unreachable') })!
    expect(provider.required).toBe(true)
    await expect(provider.list(request(), settings)).rejects.toThrow(/unreachable/)
  })

  it('maps the roster onto managed-acp descriptors pointing at our relay', async () => {
    const provider = build({
      roster: [{ alias: 'crm_bot', displayName: 'CRM', isDefault: true }],
    })!
    const descriptors = await provider.list(request(), settings)
    expect(descriptors).toEqual([
      {
        id: 'voltd-crm_bot',
        name: 'CRM',
        type: 'managed-acp',
        transport: 'websocket',
        url: 'wss://backend.volt.example/v1/voltd/ws?agent=crm_bot',
        description: null,
        icon: null,
        isSystem: 1,
      },
    ])
  })

  it('falls back to the alias when the gateway sends no display name', async () => {
    const provider = build({ roster: [{ alias: 'payroll_bot', displayName: null, isDefault: false }] })!
    const [descriptor] = await provider.list(request(), settings)
    expect(descriptor.name).toBe('payroll_bot')
  })

  it('presents the user own groups to the gateway', async () => {
    let seen = ''
    const provider = createVoltdAgentProvider({
      service: service(),
      gatewayUrl: 'wss://gateway.internal:8443/acp',
      resolveUser: async () => user({ groups: ['volt-crm', 'volt-admins'] }),
      fetchRoster: async ({ token }) => {
        seen = token
        return []
      },
    })!
    await provider.list(request(), settings)
    expect(seen).toBe('token-for-user-1-volt-crm+volt-admins')
  })

  it('contributes nothing for an anonymous session without calling the gateway', async () => {
    let called = false
    const provider = build({ resolved: user({ isAnonymous: true }), onFetch: () => (called = true) })!
    expect(await provider.list(request(), settings)).toEqual([])
    expect(called).toBe(false)
  })

  it('contributes nothing when there is no session', async () => {
    const provider = build({ resolved: null })!
    expect(await provider.list(request(), settings)).toEqual([])
  })

  it('derives ws:// from a plain-http deployment', async () => {
    const provider = build({ roster: [{ alias: 'a', displayName: null, isDefault: false }] })!
    const [descriptor] = await provider.list(new Request('http://localhost:8000/v1/agents'), settings)
    expect(descriptor.url).toBe('ws://localhost:8000/v1/voltd/ws?agent=a')
  })
})
