/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import {
  defaultModelGlm53Flash,
  defaultModelGlm53,
  defaultModels,
  defaultModelsVersion,
  hashModel,
  modelSupportsImages,
} from './models'

/**
 * Snapshot pinning the shipped defaults to their declared version. When you
 * change any default model (add/remove/edit/reorder), this test fails.
 *
 * Fix it in this order:
 *   1. Bump `defaultModelsVersion` in `shared/defaults/models.ts`.
 *   2. Update `expected` below to match the actual values from the failure.
 *
 * The version is the ordering signal reconcile uses to decide who owns the
 * newest defaults across devices (THU-637). Changing defaults without bumping
 * the version breaks that ordering silently.
 *
 * Fork note: `defaultModels` ships the free-tier OpenRouter catalog only
 * (see the header on `defaultModels` in models.ts). The upstream Opus 5 / GLM
 * rows stay exported for automations/eval but are intentionally absent here.
 */
const computeSnapshotHash = () =>
  defaultModels.map((model, index) => `${index}:${model.id}:${hashModel(model)}`).join('|')

const expected = {
  version: 7,
  hash: '0:38e10634-2fbc-4323-b86d-3a5a6c0ca824:-q1ptfc|1:d30990db-4d18-4713-8b08-ca8cabd206bb:mzov96|2:b4db7251-0475-45bb-8dfa-05dbbaa961ca:-87f1eu',
}

describe('defaultModels version snapshot', () => {
  test('version and content are in sync — read the file header if this fails', () => {
    expect({
      version: defaultModelsVersion,
      hash: computeSnapshotHash(),
    }).toEqual(expected)
  })

  test('ships complete public presentation metadata for every managed model', () => {
    for (const model of defaultModels) {
      expect(model.name).not.toBe('')
      expect(model.description).not.toBeNull()
      expect(model.vendor).not.toBeNull()
      expect(model.contextWindow).toBeGreaterThan(0)
    }
  })
})

describe('modelSupportsImages', () => {
  test('supports images for GLM 5.3 Flash but not GLM 5.3', () => {
    expect(modelSupportsImages(defaultModelGlm53Flash)).toBe(true)
    expect(modelSupportsImages(defaultModelGlm53)).toBe(false)
  })

  test('true for known vision vendors', () => {
    expect(modelSupportsImages({ vendor: 'anthropic', model: 'custom' })).toBe(true)
    expect(modelSupportsImages({ vendor: 'openai', model: 'custom' })).toBe(true)
    expect(modelSupportsImages({ vendor: 'google', model: 'custom' })).toBe(true)
  })

  test('false for unknown or absent vendors (no guessing for custom/local)', () => {
    expect(modelSupportsImages({ vendor: null, model: 'custom' })).toBe(false)
    expect(modelSupportsImages({ vendor: 'ollama', model: 'custom' })).toBe(false)
    expect(modelSupportsImages({ vendor: '', model: 'custom' })).toBe(false)
  })
})
