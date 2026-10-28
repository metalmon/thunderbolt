/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createClient, type HttpClient } from '@/lib/http'
import { isLocalMode } from '@/fork/local-mode/mode'
import { markConfigAbsent } from '@/fork/local-mode/config-absent'
import { useConfigStore, type AppConfig } from './config-store'

/**
 * Fetches the public app config from the backend and updates the config store on success.
 * On failure the store retains its persisted localStorage value, and the config still counts as loaded.
 * @param httpClient - Optional pre-configured client; when omitted, creates an unauthenticated client with `cloudUrl`.
 */
export const fetchConfig = async (cloudUrl: string, httpClient?: HttpClient): Promise<AppConfig | null> => {
  // Fork: an autonomous install has no backend to ask. Declaring the config
  // absent-and-settled here keeps the deployment-gated controls rendering, and
  // skipping the request avoids a pointless 5s timeout on every boot.
  if (isLocalMode()) {
    markConfigAbsent()
    return null
  }
  try {
    const client = httpClient ?? createClient({ prefixUrl: cloudUrl })
    const config = await client.get('config', { timeout: 5_000 }).json<AppConfig>()
    useConfigStore.getState().updateConfig(config)
    return config
  } catch {
    console.warn('Failed to fetch app config, using cached value')
    // Settled, so the gates stop waiting. Whatever is cached stands, and `{}`
    // already reads as default behaviour (standalone mode keeps its toggle).
    useConfigStore.setState({ configLoaded: true })
    return null
  }
}
