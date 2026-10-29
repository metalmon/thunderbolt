/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { createModels } from '@earendil-works/pi-ai'
import { buildBuiltinProfileModel } from '../agent/model.ts'

/**
 * The gate every BYOK turn passes and no other test reaches.
 *
 * `Models.stream()` calls `applyAuth()` BEFORE it calls `provider.stream()`, so
 * a provider whose credential is only injected inside its own `stream` wrapper
 * is refused before that wrapper ever runs:
 *
 *     Provider is not configured: byok-845fceb4-…
 *
 * Every suite in this repo — ours and upstream's — hands the harness a prepared
 * binding and never goes through `Models`, which is why a shipped binary could
 * fail on the first message of every key-based profile while the suites stayed
 * green. This test uses the REAL `createModels()` for exactly that reason.
 */
describe('BYOK profile auth, through the real Models gate', () => {
  const build = (apiKey: string) =>
    buildBuiltinProfileModel({
      profileId: 'byok-00000000-0000-4000-8000-000000000001',
      provider: 'openrouter',
      modelId: 'openrouter/free',
      apiKey,
      observeResponse: () => {},
    })

  it('resolves the profile key that the user actually entered', async () => {
    const built = build('sk-or-v1-profile-key')
    const models = createModels()
    models.setProvider(built.provider)

    const resolved = await models.getAuth(built.model, {})

    expect(resolved?.auth.apiKey).toBe('sk-or-v1-profile-key')
  })

  it('still lets an explicit per-call key win over the stored one', async () => {
    const built = build('sk-or-v1-profile-key')
    const models = createModels()
    models.setProvider(built.provider)

    const resolved = await models.getAuth(built.model, { apiKey: 'sk-or-v1-flag-key' })

    expect(resolved?.auth.apiKey).toBe('sk-or-v1-flag-key')
  })
})
