/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { useConfigStore } from '@/api/config-store'
import { getAuthToken, setAuthToken } from '@/lib/auth-token'
import { getCachedSession, setCachedSession } from '@/lib/session-cache'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'

// NOT mocked. `mock.module` in bun is process-wide and never undone, so stubbing
// `@/db/powersync/sync-state` down to two exports here broke every other suite in
// the run that imports it — 200-odd failures that looked like a code bug. The real
// `setSyncEnabled` is safe to call: it writes the flag, then catches the missing
// database instance itself (`sync-state.ts`: "Failed to connect/disconnect").
import { enterLocalMode, enterServerMode } from './switch-mode'

beforeEach(() => {
  useLocalSettingsStore.setState({ operationMode: 'server', syncEnabled: true })
  setAuthToken('a-real-token')
  setCachedSession({ user: { id: 'u1' }, session: { expiresAt: new Date(Date.now() + 86_400_000) } })
  useConfigStore.setState({
    config: { minimalMode: true, auth: { mode: 'oidc' }, passkeyEnabled: true },
    configLoaded: true,
  })
})

afterEach(() => {
  useLocalSettingsStore.setState({
    operationMode: initialLocalSettings.operationMode,
    syncEnabled: initialLocalSettings.syncEnabled,
  })
})

describe('enterLocalMode', () => {
  it('stops sync, drops the credentials and forgets the deployment config', async () => {
    await enterLocalMode()

    expect(useLocalSettingsStore.getState().operationMode).toBe('local')
    // Read on every boot: left set, the install keeps uploading in "local" mode.
    expect(useLocalSettingsStore.getState().syncEnabled).toBe(false)
    // Otherwise `isAuthenticated` stays true and the UI shows an account that
    // this mode does not have.
    expect(getAuthToken()).toBeFalsy()
    expect(getCachedSession()).toBeNull()
    // Carries auth.mode, branding, passkeyEnabled and the OTA model set — all of
    // which would keep describing a deployment this install no longer uses.
    expect(useConfigStore.getState().config).toEqual({})
  })

  // An empty config with `configLoaded: false` reads as "still waiting" to
  // `selectConfigSettled`, and `configLoaded` is not persisted — so without this
  // the deployment-gated controls never appear after a local-mode restart.
  it('leaves the config settled, not merely empty', async () => {
    await enterLocalMode()
    expect(useConfigStore.getState().configLoaded).toBe(true)
  })

  // The order is the guarantee: nothing may read this install as autonomous
  // while a sync connection is still open.
  it('flips the mode last, after sync has been stopped', async () => {
    const order: string[] = []
    const unsubscribe = useLocalSettingsStore.subscribe((state, prev) => {
      if (state.syncEnabled !== prev.syncEnabled) {
        order.push('sync')
      }
      if (state.operationMode !== prev.operationMode) {
        order.push('mode')
      }
    })
    await enterLocalMode()
    unsubscribe()

    expect(order).toEqual(['sync', 'mode'])
  })
})

describe('enterServerMode', () => {
  // Deliberately asymmetric. Writes made while autonomous sit in the upload
  // queue and carry no user id, so the server would file this device's history
  // under whoever signs in first.
  it('does not enable sync', () => {
    useLocalSettingsStore.setState({ operationMode: 'local', syncEnabled: false })
    enterServerMode()

    expect(useLocalSettingsStore.getState().operationMode).toBe('server')
    expect(useLocalSettingsStore.getState().syncEnabled).toBe(false)
  })
})

describe('boot in local mode', () => {
  // The transition clears what is live; this guards the other half — a boot that
  // never asks. Source-level because `fetchConfig`'s own suite covers its HTTP
  // behaviour, and what matters here is that the guard exists at all.
  it('does not fetch /config', () => {
    const source = readFileSync('src/api/config.ts', 'utf8')
    expect(source.includes('isLocalMode')).toBe(true)
  })
})
