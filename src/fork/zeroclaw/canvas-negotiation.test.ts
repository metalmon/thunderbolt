/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import { canvasMetaKey, buildCanvasCapabilityMeta, supportsCanvasCapability } from './canvas-negotiation'

describe('buildCanvasCapabilityMeta', () => {
  it('advertises host support for the Canvas Action Channel', () => {
    expect(buildCanvasCapabilityMeta()).toEqual({
      [canvasMetaKey]: { supported: true },
    })
  })
})

describe('supportsCanvasCapability', () => {
  it('detects the capability in a well-formed _meta fragment', () => {
    expect(supportsCanvasCapability(buildCanvasCapabilityMeta())).toBe(true)
  })

  it('rejects a present namespace whose flag is false', () => {
    expect(supportsCanvasCapability({ [canvasMetaKey]: { supported: false } })).toBe(false)
  })

  it('rejects a malformed namespace value', () => {
    expect(supportsCanvasCapability({ [canvasMetaKey]: 'yes' })).toBe(false)
    expect(supportsCanvasCapability({ [canvasMetaKey]: null })).toBe(false)
  })

  it('returns false when the namespace or _meta itself is absent', () => {
    expect(supportsCanvasCapability({})).toBe(false)
    expect(supportsCanvasCapability(null)).toBe(false)
    expect(supportsCanvasCapability(undefined)).toBe(false)
  })
})
