/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import {
  defaultModelOpenRouterFree,
  defaultModelOpus5,
  defaultModels,
  defaultModelsVersion,
} from '@shared/defaults/models'
import { pickModelsDefaults } from './pick-defaults'

const serverPayload = (version: number) => ({
  version,
  // Template off a BUNDLED default so the payload overlaps bundle ids (the
  // non-overlap guard would otherwise force the bundle to win).
  data: [{ ...defaultModelOpenRouterFree, name: `Server v${version}` }],
})

/**
 * Bundle fixture. These rules describe how a server payload is weighed against the
 * BUNDLE, and this fork ships an empty one — so the bundle is supplied here. The
 * model is OpenRouter Free because it is the id whose profile the build still
 * bundles, which is what `reconcileDefaults` requires before it will seed anything.
 */
const fixtureBundle = { version: defaultModelsVersion, data: [defaultModelOpenRouterFree] as const }

describe('pickModelsDefaults', () => {
  test('bundle wins when server is absent (offline / no fetch yet)', () => {
    const picked = pickModelsDefaults(undefined, fixtureBundle)
    expect(picked.version).toBe(fixtureBundle.version)
    expect(picked.data).toBe(fixtureBundle.data)
  })

  test('server wins when it declares a strictly higher version', () => {
    const server = serverPayload(defaultModelsVersion + 1)
    const picked = pickModelsDefaults(server, fixtureBundle)
    expect(picked.version).toBe(server.version)
    expect(picked.data).toBe(server.data)
  })

  test('bundle wins when server declares an equal version (avoid needless swap)', () => {
    const picked = pickModelsDefaults(serverPayload(defaultModelsVersion), fixtureBundle)
    expect(picked.version).toBe(fixtureBundle.version)
    expect(picked.data).toBe(fixtureBundle.data)
  })

  test('bundle wins when server declares a lower version (rollback protection)', () => {
    const picked = pickModelsDefaults(serverPayload(defaultModelsVersion - 1), fixtureBundle)
    expect(picked.version).toBe(fixtureBundle.version)
    expect(picked.data).toBe(fixtureBundle.data)
  })

  test('bundle wins when server ships a bumped version with empty data (malformed payload)', () => {
    // Otherwise cleanupRemovedDefaults would soft-delete every unedited system
    // model against an empty currentModelIds set.
    const picked = pickModelsDefaults({ version: defaultModelsVersion + 5, data: [] }, fixtureBundle)
    expect(picked.version).toBe(fixtureBundle.version)
    expect(picked.data).toBe(fixtureBundle.data)
  })

  test('bundle wins when server ships a bumped version with a non-array data value', () => {
    // Runtime defense against a malformed JSON response the type system can't catch.
    const picked = pickModelsDefaults(
      { version: defaultModelsVersion + 5, data: null as unknown as (typeof defaultModels)[number][] },
      fixtureBundle,
    )
    expect(picked.version).toBe(fixtureBundle.version)
    expect(picked.data).toBe(fixtureBundle.data)
  })

  test('bundle wins when server ships a non-finite version (NaN / Infinity)', () => {
    // A "bumped" version that isn't a real number is malformed — treating NaN as
    // higher than the bundle would let bad server responses win.
    for (const version of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const picked = pickModelsDefaults(serverPayload(version), fixtureBundle)
      expect(picked.version).toBe(fixtureBundle.version)
      expect(picked.data).toBe(fixtureBundle.data)
    }
  })

  test('bundle wins when server payload has zero overlap with bundled ids (wholesale replacement)', () => {
    // Guards `cleanupRemovedDefaults` from treating every bundle-known row as
    // retired. On this fork the bundle is EMPTY, so the rule also means a payload
    // can never arrive on its own: a model is only ever seeded when the BUILD
    // bundles a profile for its id (see `bundledProfileModelIds` in
    // reconcile-defaults), which is why relaxing this for an empty bundle would
    // promise models the pipeline then drops anyway.
    const disjointPayload = {
      version: defaultModelsVersion + 5,
      data: [
        { ...defaultModelOpus5, id: 'disjoint-id-1', name: 'Fully Different Model 1' },
        { ...defaultModelOpus5, id: 'disjoint-id-2', name: 'Fully Different Model 2' },
      ],
    }
    const picked = pickModelsDefaults(disjointPayload, fixtureBundle)
    expect(picked.version).toBe(fixtureBundle.version)
    expect(picked.data).toBe(fixtureBundle.data)
  })

  test('server wins when the payload has any overlap with bundled ids (partial overlap ok)', () => {
    // One overlapping id is enough to signal a non-pathological payload —
    // retirement of some bundle ids via partial payload is a legitimate OTA
    // use case and should still work.
    const partialOverlap = {
      version: defaultModelsVersion + 1,
      data: [
        defaultModelOpenRouterFree, // in bundle
        { ...defaultModelOpus5, id: 'new-id', name: 'Server-only New Model' },
      ],
    }
    const picked = pickModelsDefaults(partialOverlap, fixtureBundle)
    expect(picked.version).toBe(defaultModelsVersion + 1)
    expect(picked.data).toBe(partialOverlap.data)
  })
})
