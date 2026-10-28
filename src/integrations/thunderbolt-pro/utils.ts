/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isLocalMode } from '@/fork/local-mode/mode'
import type { ThunderboltProStatus } from './types'

// Hardcoded constant for testing - can be switched back and forth
const isProUser = true // Set to false to test "Get Pro" button

/**
 * Get the current user's pro status
 */
export const getProStatus = async (): Promise<ThunderboltProStatus> => {
  return {
    isProUser,
    features: isProUser ? ['search', 'web_fetch', 'weather', 'weather_forecast'] : [],
  }
}

/**
 * Check if user has access to pro features
 */
export const hasProAccess = async (): Promise<boolean> => {
  // Fork: every Pro feature is a call to OUR backend (`/v1/search`,
  // `/v1/pro/fetch-content`, `/v1/preview`), so an autonomous install has none
  // of them. This predicate is the single gate for both the integrations UI and
  // the tool list handed to the model — the latter matters more: a model holding
  // a search tool it cannot reach keeps calling it.
  if (isLocalMode()) {
    return false
  }
  const status = await getProStatus()
  return status.isProUser
}
