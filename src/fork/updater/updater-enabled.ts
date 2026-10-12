/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fork: build-time kill switch for the desktop auto-updater.
 *
 * Volt ships into closed perimeters with no route to the update CDN, where the
 * check can only ever fail — and a failed check is not silent: it raises an
 * «Не удалось обновить» card naming an unreachable `cdn.crabnebula.app` URL,
 * on every launch, forever. Set `VITE_UPDATER_ENABLED=false` for those builds
 * and every update surface disappears: the startup check, the toast, and the
 * Updates block in Settings.
 *
 * Opt-out rather than opt-in on purpose — an unset variable must keep the
 * updater working, so an ordinary build (and our own CrabNebula channel) is
 * unaffected by a deployment that forgets to set it.
 */
export const isUpdaterEnabled = (): boolean => import.meta.env.VITE_UPDATER_ENABLED !== 'false'
