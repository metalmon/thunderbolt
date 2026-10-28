/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getLocalSetting, useLocalSettingsStore } from '@/stores/local-settings-store'

/**
 * Whether this installation runs without a backend of its own.
 *
 * Two products share one binary. In **server** mode the app signs the user in,
 * syncs, and offers the lanes whose keys live on our backend. In **local** mode
 * there is no account at all: the user brought their own providers, models and
 * agent, and everything that needs our backend is gone rather than present and
 * broken.
 *
 * "No account" is the whole design, not a shortcut. Nothing in the local schema
 * carries a user id — `src/db/powersync/schema.ts` has none, because identity is
 * assigned server-side by the sync rules from the token — so there is no local
 * identity to invent, and inventing one would only have to be reconciled away
 * the day a server appears.
 *
 * The rule for deciding what to switch off: **disable the lane that goes through
 * our backend, never the capability.** A model with the user's own key still
 * works; the `managed` lane does not. Voice through `openai-compatible` still
 * works; voice through `/v1/audio/*` does not. Weather still works — it talks to
 * open-meteo directly and never touched our backend at all.
 */
export const isLocalMode = (): boolean => getLocalSetting('operationMode') === 'local'

/**
 * The reactive form, for components that must re-render when the mode changes.
 *
 * Non-React callers (transport pickers, tool assembly, the model list) use
 * {@link isLocalMode}: they are consulted per request or per render anyway, so a
 * subscription would buy nothing.
 */
export const useIsLocalMode = (): boolean => useLocalSettingsStore((s) => s.operationMode === 'local')
