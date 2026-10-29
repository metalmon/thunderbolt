/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { commandName, envPrefix, envVar, envVarNames, legacyEnvPrefix, stateDirName } from './identity.ts'

describe('identity', () => {
  it('names the command and its state directory consistently', () => {
    expect(commandName).toBe('volt')
    expect(stateDirName).toBe('.volt')
  })

  it('prefers the current environment variable', () => {
    const env = { VOLT_CLOUD_URL: 'https://new/v1', THUNDERBOLT_CLOUD_URL: 'https://old/v1' }
    expect(envVar('CLOUD_URL', env)).toBe('https://new/v1')
  })

  // Not for our users — this fork never shipped a CLI — but for anyone replacing
  // the upstream binary, whose exports would otherwise be ignored in silence.
  it('falls back to the legacy variable', () => {
    expect(envVar('CLOUD_URL', { THUNDERBOLT_CLOUD_URL: 'https://old/v1' })).toBe('https://old/v1')
  })

  it('reports undefined when neither is set', () => {
    expect(envVar('CLOUD_URL', {})).toBeUndefined()
  })

  // An empty export is a value, not an absence: `??` keeps it, so a deliberately
  // blanked variable does NOT silently fall through to the legacy one.
  it('treats an empty current variable as set', () => {
    expect(envVar('TOKEN', { VOLT_TOKEN: '', THUNDERBOLT_TOKEN: 'legacy' })).toBe('')
  })

  it('spells both names for help text', () => {
    expect(envVarNames('HOME')).toEqual({ current: 'VOLT_HOME', legacy: 'THUNDERBOLT_HOME' })
    expect(envPrefix).toBe('VOLT')
    expect(legacyEnvPrefix).toBe('THUNDERBOLT')
  })
})
