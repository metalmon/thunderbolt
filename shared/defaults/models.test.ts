/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { hashValues } from '../lib/hash'
import {
  defaultModelGlm53,
  defaultModels,
  defaultModelsVersion,
  hashModel,
  isKnownToReadImages,
  type ImageSupportModel,
  staticImageSupport,
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

// `hashModel` deliberately hashes only user-editable fields (it drives the
// user-edit detection in reconciliation), so it is blind to metadata like
// `vendor` and `description`. Hash those separately here so a metadata-only
// defaults change still trips the snapshot and gets its version bump.
const computeMetadataHash = () =>
  defaultModels.map((model, index) => `${index}:${hashValues([model.vendor, model.description])}`).join('|')

const expected = {
  version: 10,
  hash: '0:38e10634-2fbc-4323-b86d-3a5a6c0ca824:-p0uvif',
  metadataHash: '0:xlomh0',
}

describe('defaultModels version snapshot', () => {
  test('version and content are in sync — read the file header if this fails', () => {
    expect({
      version: defaultModelsVersion,
      hash: computeSnapshotHash(),
      metadataHash: computeMetadataHash(),
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

  test('declares image support for every shipped default (the CLI can’t detect it)', () => {
    for (const model of defaultModels) {
      expect({ model: model.model, support: defaultModelImageSupport[model.id] }).toEqual({
        model: model.model,
        support: expect.stringMatching(/^(supported|unsupported)$/),
      })
    }
  })
})

describe('staticImageSupport', () => {
  const model = (overrides: Partial<ImageSupportModel>): ImageSupportModel => ({
    provider: 'custom',
    model: 'llava',
    url: 'http://localhost:11434/v1',
    vendor: null,
    ...overrides,
  })

  test('answers for the shipped defaults from their declarations', () => {
    expect(staticImageSupport(defaultModelOpus55)).toBe('supported')
    expect(staticImageSupport(defaultModelDeepSeekV41Flash)).toBe('supported')
    expect(staticImageSupport(defaultModelGlm53)).toBe('unsupported')
  })

  test('applies a default’s declaration to any row on the same provider and model', () => {
    // A user-added Tinfoil row (personal key, no vendor) serving the same upstream model.
    expect(staticImageSupport(model({ provider: 'tinfoil', model: 'glm-5-3', url: null }))).toBe('unsupported')
  })

  test('treats every native Anthropic model as reading images', () => {
    expect(staticImageSupport(model({ provider: 'anthropic', model: 'claude-sonnet-5', url: null }))).toBe('supported')
  })

  test('treats other Thunderbolt-hosted models from vision vendors as reading images', () => {
    expect(staticImageSupport(model({ provider: 'thunderbolt', model: 'gpt-5', vendor: 'openai' }))).toBe('supported')
  })

  test('isKnownToReadImages sends images only on a known "supported"', () => {
    expect(isKnownToReadImages(defaultModelDeepSeekV41Flash)).toBe(true)
    expect(isKnownToReadImages(defaultModelGlm53)).toBe(false)
    expect(isKnownToReadImages(model({}))).toBe(false)
  })

  test('leaves everything else to detection', () => {
    expect(staticImageSupport(model({}))).toBeUndefined()
    expect(staticImageSupport(model({ provider: 'thunderbolt', model: 'glm', vendor: 'zhipu' }))).toBeUndefined()
    // A vendor only vouches for models Thunderbolt hosts; Tinfoil serves text-only models from vision vendors.
    expect(staticImageSupport(model({ provider: 'tinfoil', model: 'gpt-oss-120b', vendor: 'openai' }))).toBeUndefined()
  })
})
