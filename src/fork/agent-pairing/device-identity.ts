/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { hostname } from '@tauri-apps/plugin-os'
import { getDeviceDisplayName, getPlatform, isTauri } from '@/lib/platform'

/**
 * What this device calls itself when it pairs with an agent gateway.
 *
 * The gateway's admin page lists paired devices by these two fields, and listed
 * every one of ours as "Без названия" — so they are what an operator uses to tell
 * one machine from another when revoking access. Both are capped by the gateway:
 * 120 characters for the name, 32 for the type, and it is better to send a
 * truncated name than to have the field rejected.
 *
 * The name is `<host> (Volt <version>)`. The host is what distinguishes machines;
 * the version is what tells an operator which build to update. The gateway asked
 * for `<user>@<host>` — the OS user is not reachable from the webview (the os
 * plugin exposes `hostname` and nothing about the account) and would need its own
 * Tauri command, so the user half is left out rather than faked. Callers that DO
 * know a better name — the add-agent form knows the signed-in account — can pass
 * `deviceName` to `pairOverAcp` and this is not consulted.
 */

/** Gateway limits. Exported so the tests pin the same numbers the contract names. */
export const maxPairingDeviceNameLength = 120
export const maxPairingDeviceTypeLength = 32

/** Truncate to a byte-safe length without leaving a dangling surrogate pair. */
const cap = (value: string, limit: number): string => {
  if (value.length <= limit) {
    return value
  }
  const sliced = value.slice(0, limit)
  // A lone high surrogate at the end would be an invalid string on the wire.
  const last = sliced.charCodeAt(sliced.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced
}

/**
 * The device class, as the gateway's `device_type`.
 *
 * Deliberately coarse: an operator revoking a device cares whether it is a desktop,
 * a phone or a browser tab, not which OS build it runs.
 */
export const pairingDeviceType = (): string => {
  if (!isTauri()) {
    return 'web'
  }
  const platform = getPlatform()
  if (platform === 'android' || platform === 'ios') {
    return 'mobile'
  }
  return cap('desktop', maxPairingDeviceTypeLength)
}

/**
 * The device name, as the gateway's `device_name`.
 *
 * @param readHostname - test seam; production reads the OS plugin
 */
export const pairingDeviceName = async (
  // Defaults to the OS plugin on desktop and to "no host" everywhere else, so the
  // real branch — the one that builds `<host> (Volt x.y.z)` — is reachable in a
  // test instead of being skipped by an `isTauri()` check it cannot satisfy.
  readHostname: () => Promise<string | null> = isTauri() ? hostname : async () => null,
): Promise<string> => {
  const version = import.meta.env.VITE_APP_VERSION
  const suffix = version ? ` (Volt ${version})` : ' (Volt)'

  // A failure here must not block pairing — an unnamed device still beats no agent.
  const host = await readHostname().catch(() => null)
  if (!host?.trim()) {
    // No hostname (browser, or the lookup failed): the generic label already says
    // browser-and-OS, and appending the version to it would only repeat the build.
    return cap(getDeviceDisplayName(), maxPairingDeviceNameLength)
  }
  return cap(`${host.trim()}${suffix}`, maxPairingDeviceNameLength)
}
