/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { locale as readOsLocale } from '@tauri-apps/plugin-os'
import { isTauri } from '@/lib/platform'

let systemTags: readonly string[] = []

/**
 * The operating system's language tags — empty on the web and until
 * {@link loadSystemLocale} has answered.
 *
 * ⚠ Read because `navigator.languages` is NOT the user's language on the
 * desktop. WebView2 reports the language the *application* runs in, which for
 * an unlocalized Tauri binary is `en-US` on a Russian Windows — so a Russian
 * user was offered an English app and had to pick Russian by hand in
 * onboarding, on a product that is Russian-first. Reported from a real install,
 * 0.1.148.
 *
 * Prepended to the browser tags rather than replacing them, so everything that
 * negotiates — the boot locale, the seeded `language` setting, the onboarding
 * step — agrees on one answer, and the browser still has the final say on the
 * web where there is no OS to ask.
 */
export const getSystemLanguages = (): readonly string[] => systemTags

/** The real source: the OS on the desktop, nothing on the web. */
const readPlatformLocale = async (): Promise<string | null> => (isTauri() ? await readOsLocale() : null)

/**
 * Ask the OS for its language once, at boot.
 *
 * Deliberately not awaited by the render path: the tag arrives in an IPC
 * round-trip, and a user who has already chosen a language is served from the
 * stored setting anyway. The caller re-resolves once this resolves.
 *
 * @param read Where the tag comes from; the parameter is the test seam —
 *   `mock.module` is process-wide in bun and would follow other suites around.
 */
export const loadSystemLocale = async (read: () => Promise<string | null> = readPlatformLocale): Promise<void> => {
  const tag = await read()
  systemTags = tag ? [tag] : []
}
