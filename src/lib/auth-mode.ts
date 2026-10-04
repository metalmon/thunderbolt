/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { deploymentAllowsAnonymous, deploymentUsesSso } from '@/fork/auth/deployment-auth-mode'

// Fork: the DEPLOYMENT decides, not the build — one build serves every customer.
// Falls back to the baked value when the server does not report one.
export const isSsoMode = () => deploymentUsesSso()

/**
 * Returns true when anonymous-session auto-creation is enabled for this deployment.
 * Mirrors the operator-controlled overlay alongside the primary auth path (email-OTP or SSO).
 */
export const isAnonymousAuthEnabled = () => deploymentAllowsAnonymous()

/**
 * Returns true when the waitlist gate is bypassed for this deployment
 */
export const isWaitlistBypassed = () => import.meta.env.VITE_BYPASS_WAITLIST === 'true'
