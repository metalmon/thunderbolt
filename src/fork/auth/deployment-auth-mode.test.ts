/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { deploymentAllowsAnonymous, deploymentUsesSso } from './deployment-auth-mode'

describe('the deployment decides the sign-in flow', () => {
  it('follows the server into SSO', () => {
    expect(deploymentUsesSso({ auth: { mode: 'oidc' } })).toBe(true)
    expect(deploymentUsesSso({ auth: { mode: 'saml' } })).toBe(true)
  })

  it('follows the server OUT of SSO — a consumer backend is an answer too', () => {
    // The build flag said sso for every pilot binary; obeying it against a consumer
    // deployment would strand that user exactly as the reverse stranded the pilot.
    expect(deploymentUsesSso({ auth: { mode: 'consumer' } })).toBe(false)
  })

  it('reports anonymous sign-in only where the backend actually mounts it', () => {
    // The 404 that started this: the endpoint exists only when the deployment
    // enables it, so asking without checking is the bug.
    expect(deploymentAllowsAnonymous({ auth: { mode: 'oidc', allowAnonymous: false } })).toBe(false)
    expect(deploymentAllowsAnonymous({ auth: { mode: 'consumer', allowAnonymous: true } })).toBe(true)
  })

  it('falls back to the build when the server does not report — an older backend still works', () => {
    // Undefined is "unknown", not "no": a client must not change behaviour against
    // a backend that predates this field.
    const baked = import.meta.env.VITE_AUTH_MODE === 'sso'
    expect(deploymentUsesSso({})).toBe(baked)
    expect(deploymentUsesSso({ auth: {} })).toBe(baked)
  })
})
