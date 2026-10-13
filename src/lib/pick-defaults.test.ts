/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import type { defaultModels } from '@shared/defaults/models'
import { defaultModelOpenRouterFree, defaultModelOpus55, defaultModelsVersion } from '@shared/defaults/models'
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
    // retired. The rule is about protecting rows that exist, so it applies only
    // while the bundle ships some — see the empty-bundle case below.
    const disjointPayload = {
      version: defaultModelsVersion + 5,
      data: [
        { ...defaultModelOpus55, id: 'disjoint-id-1', name: 'Fully Different Model 1' },
        { ...defaultModelOpus55, id: 'disjoint-id-2', name: 'Fully Different Model 2' },
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
        { ...defaultModelOpus55, id: 'new-id', name: 'Server-only New Model' },
      ],
    }
    const picked = pickModelsDefaults(partialOverlap, fixtureBundle)
    expect(picked.version).toBe(defaultModelsVersion + 1)
    expect(picked.data).toBe(partialOverlap.data)
  })
  test('server wins on a build that bundles no models at all (the deployment publishes the lineup)', () => {
    // This fork ships an empty `defaultModels`: which models a pilot offers is a
    // deployment decision, so the server supplies them. There are no bundled rows for
    // the overlap rule to protect, and testing overlap against an empty set would
    // reject every payload — muting the only channel that can deliver a lineup.
    const emptyBundle = { version: defaultModelsVersion, data: [] as const }
    const published = {
      version: defaultModelsVersion + 1,
      data: [
        { ...defaultModelOpus55, id: 'pilot-model-1', name: 'Pilot Model 1' },
        { ...defaultModelOpus55, id: 'pilot-model-2', name: 'Pilot Model 2' },
      ],
    }
    const picked = pickModelsDefaults(published, emptyBundle)
    expect(picked.version).toBe(defaultModelsVersion + 1)
    expect(picked.data).toBe(published.data)
  })

  test('an empty bundle with no server payload stays empty rather than failing', () => {
    // The normal state today: nothing published yet. Reconcile must get a well-formed
    // empty set and write nothing, which is what keeps the app running without one.
    const emptyBundle = { version: defaultModelsVersion, data: [] as const }
    const picked = pickModelsDefaults(undefined, emptyBundle)
    expect(picked.version).toBe(defaultModelsVersion)
    expect(picked.data).toEqual([])
  })
})
