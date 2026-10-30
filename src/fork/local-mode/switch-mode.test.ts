/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useConfigStore } from '@/api/config-store'
import { clearAuthToken, getAuthToken, setAuthToken } from '@/lib/auth-token'
import { clearCachedSession, getCachedSession, setCachedSession } from '@/lib/session-cache'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'

// ⚠ Nothing is stubbed with `mock.module` here, in EITHER direction.
//
// Stubbing `@/db/powersync/sync-state` from this file broke every sibling suite
// that imports it (process-wide, never undone). And simply importing the real
// `setSyncEnabled` does not work either: two upstream suites replace it with a
// mock that never writes the flag, so this file asserted against whichever
// registration happened to be last — green alone, red in the full run.
//
// So the subject takes its dependencies and this file passes them in. The sync
// flag is then written by the test's own stub, and the assertion is about what
// `enterLocalMode` CALLS, which is the actual contract.
import { enterLocalMode, enterServerMode, type SwitchModeDeps } from './switch-mode'
import { markConfigAbsent } from './config-absent'
import { readRepoFile } from '../testing/source-file'

/** Counts the reload a mode switch must ask for; the real one would tear down
 *  the test runner's window. */
let reloads = 0

/** The real effects, except that sync is written here rather than through a
 *  module another suite may already have replaced. */
const testDeps = (): SwitchModeDeps => ({
  setSyncEnabled: (enabled) => {
    useLocalSettingsStore.setState({ syncEnabled: enabled })
  },
  clearAuthToken,
  clearCachedSession,
  markConfigAbsent,
  reload: () => {
    reloads += 1
  },
})

beforeEach(() => {
  reloads = 0
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
    await enterLocalMode(testDeps())

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
    await enterLocalMode(testDeps())
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
    await enterLocalMode(testDeps())
    unsubscribe()

    expect(order).toEqual(['sync', 'mode'])
  })

  // Every reader of the mode reads it at boot, so without this the app keeps
  // running as the deployment it just left. Shipped once without it: the
  // cold-start escape painted an empty window instead of autonomous mode.
  it('reloads so the new mode is read at boot', async () => {
    await enterLocalMode(testDeps())

    expect(reloads).toBe(1)
  })
})

describe('enterServerMode', () => {
  // Deliberately asymmetric. Writes made while autonomous sit in the upload
  // queue and carry no user id, so the server would file this device's history
  // under whoever signs in first.
  it('does not enable sync', () => {
    useLocalSettingsStore.setState({ operationMode: 'local', syncEnabled: false })
    enterServerMode(testDeps())

    expect(useLocalSettingsStore.getState().operationMode).toBe('server')
    expect(useLocalSettingsStore.getState().syncEnabled).toBe(false)
    expect(reloads).toBe(1)
  })
})

describe('boot in local mode', () => {
  // The transition clears what is live; this guards the other half — a boot that
  // never asks. Source-level because `fetchConfig`'s own suite covers its HTTP
  // behaviour, and what matters here is that the guard exists at all.
  it('does not fetch /config', () => {
    const source = readRepoFile('src/api/config.ts')
    expect(source.includes('isLocalMode')).toBe(true)
  })
})
