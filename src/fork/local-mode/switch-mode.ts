/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setSyncEnabled } from '@/db/powersync/sync-state'
import { markConfigAbsent } from './config-absent'
import { clearAuthToken } from '@/lib/auth-token'
import { clearCachedSession } from '@/lib/session-cache'
import { useLocalSettingsStore } from '@/stores/local-settings-store'

/**
 * Switch this installation to autonomous operation.
 *
 * Flipping the flag alone is not enough, and each of these is a real leak:
 *  - `syncEnabled` is read on EVERY boot (`database.ts`: `if (isSyncEnabled())
 *    connectToSync()`), so an install left with it set would keep uploading in
 *    "local" mode. `setSyncEnabled(false)` also disconnects a live session.
 *  - the bearer token and the cached session survive otherwise, which makes
 *    `isAuthenticated` true and shows a signed-in account in a mode that has no
 *    account.
 *  - the cached `/config` survives on purpose (that is what lets the app boot
 *    offline), and it carries `auth.mode`, `auth.allowAnonymous`, `branding`,
 *    `passkeyEnabled` and the OTA model set — so the app would go on believing
 *    it is an SSO deployment with an operator brand and a server model lineup.
 *    (Analytics are NOT in there: the PostHog key comes from its own
 *    `posthog/config` request, gated separately in `initPosthog`.)
 *
 * The flag is flipped LAST: until it is, nothing reads this install as
 * autonomous, so there is no window where the mode says "local" while a sync
 * connection is still open.
 *
 * The credential half is {@link dropServerCredentials}, separate because
 * RETARGETING one backend to another needs exactly the same thing: a token
 * issued by one server must never be presented to a different one, and the
 * config describing the old deployment must not survive into the new one.
 */
export const dropServerCredentials = async () => {
  await setSyncEnabled(false)
  clearAuthToken()
  clearCachedSession()
  markConfigAbsent()
}

export const enterLocalMode = async () => {
  await dropServerCredentials()
  useLocalSettingsStore.getState().setLocalSetting('operationMode', 'local')
}

/**
 * Switch back to a deployment with a backend.
 *
 * Deliberately asymmetric: this does NOT enable sync. Writes made while
 * autonomous sit in PowerSync's upload queue and carry no user id — the server
 * assigns one from whoever's token arrives — so turning sync on here would push
 * this device's history into the first account that signs in. Sync is enabled
 * only after the user has signed in and chosen what happens to the local data.
 */
export const enterServerMode = () => {
  useLocalSettingsStore.getState().setLocalSetting('operationMode', 'server')
}
