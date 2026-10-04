/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useConfigStore } from '@/api/config-store'

/**
 * How the deployment the client is pointed at signs people in.
 *
 * One build serves every customer — the same principle as the baked backend
 * address — so the sign-in flow cannot be decided at build time. It was, and the
 * installed pilot client asked an `AUTH_MODE=oidc` backend for
 * `/sign-in/anonymous`, took a 404 and died before rendering anything.
 *
 * The deployment is the only thing that knows, and the client already fetches
 * `/v1/config` before it renders (`step0_fetch_config` in the boot trace), so the
 * answer is there by the time anything asks. The build-time flags remain the
 * fallback for a backend too old to report, and for the tests.
 */

/** `VITE_AUTH_MODE === 'sso'`, the value baked at build time. */
const bakedSsoMode = (): boolean => import.meta.env.VITE_AUTH_MODE === 'sso'

/** `VITE_AUTH_ENABLE_ANONYMOUS === 'true'`, the value baked at build time. */
const bakedAnonymous = (): boolean => import.meta.env.VITE_AUTH_ENABLE_ANONYMOUS === 'true'

/**
 * Whether this deployment authenticates through an external IdP.
 *
 * @param config - test seam; production reads the loaded config
 */
export const deploymentUsesSso = (config = useConfigStore.getState().config): boolean => {
  const mode = config?.auth?.mode
  // 'consumer' is an answer too — an older client pointed at a consumer backend
  // must not be dragged into SSO just because it was built for it.
  return mode === undefined ? bakedSsoMode() : mode === 'oidc' || mode === 'saml'
}

/**
 * Whether anonymous sessions exist here at all. The backend only mounts the
 * endpoint when they do, so asking without checking is the 404 above.
 *
 * @param config - test seam; production reads the loaded config
 */
export const deploymentAllowsAnonymous = (config = useConfigStore.getState().config): boolean => {
  const allowed = config?.auth?.allowAnonymous
  return allowed === undefined ? bakedAnonymous() : allowed
}
