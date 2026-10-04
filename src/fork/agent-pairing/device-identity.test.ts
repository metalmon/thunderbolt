/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import {
  maxPairingDeviceNameLength,
  maxPairingDeviceTypeLength,
  pairingDeviceName,
  pairingDeviceType,
} from './device-identity'

describe('pairing device identity', () => {
  it('names the device after its host so an operator can tell machines apart', async () => {
    const name = await pairingDeviceName(async () => 'VOLT-PILOT-01')
    expect(name).toContain('VOLT-PILOT-01')
  })

  it('never exceeds the gateway caps — a longer field is rejected outright', async () => {
    const name = await pairingDeviceName(async () => 'x'.repeat(400))
    expect(name.length).toBeLessThanOrEqual(maxPairingDeviceNameLength)
    expect(pairingDeviceType().length).toBeLessThanOrEqual(maxPairingDeviceTypeLength)
  })

  it('falls back to the generic label when the host cannot be read, rather than failing to pair', async () => {
    const rejected = await pairingDeviceName(async () => {
      throw new Error('no IPC')
    })
    expect(rejected.length).toBeGreaterThan(0)

    const blank = await pairingDeviceName(async () => '   ')
    expect(blank.length).toBeGreaterThan(0)
  })

  it('reports a device class the admin list can group by', () => {
    // Outside Tauri — which is what the test environment is — this is a browser.
    expect(pairingDeviceType()).toBe('web')
  })
})
