/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ProviderStatus } from '../provider-runtime/types.ts'
import { i18n } from './i18n.ts'

/**
 * The status of a provider, as the user reads it.
 *
 * `ProviderStatus` is a VALUE — it is compared, stored and branched on — so it
 * stays English, and this maps it to display text at the point of render. The
 * app does the same for tool descriptions (`tool-display-descriptions.ts`) and
 * for the same reason: translating the value itself would make the comparisons
 * depend on the user's language.
 */
export const providerStatusLabel = (status: ProviderStatus): string => {
  if (status === 'authenticated') {
    return i18n._({ id: 'authenticated' })
  }
  if (status === 'authentication required') {
    return i18n._({ id: 'authentication required' })
  }
  return i18n._({ id: 'not authenticated' })
}
