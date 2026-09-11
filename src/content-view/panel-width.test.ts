/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { artifactMaxWidthPx, defaultArtifactOpenWidth, defaultOpenWidth, minimumWidthThreshold } from './constants'
import { openTargetWidth } from './panel-width'

describe('openTargetWidth', () => {
  test('artifact type with no saved width falls back to the artifact default (66)', () => {
    expect(openTargetWidth('artifact', null, null)).toBe(defaultArtifactOpenWidth)
  })

  test('artifact type uses the saved artifact width when above threshold', () => {
    expect(openTargetWidth('artifact', 80, 50)).toBe(80)
  })

  test('artifact type ignores the content-view width entirely', () => {
    expect(openTargetWidth('artifact', null, 90)).toBe(defaultArtifactOpenWidth)
  })

  test('other view types with no saved width fall back to the content default (50)', () => {
    expect(openTargetWidth('sideview', null, null)).toBe(defaultOpenWidth)
    expect(openTargetWidth('preview', null, null)).toBe(defaultOpenWidth)
    expect(openTargetWidth('object-view', null, null)).toBe(defaultOpenWidth)
    expect(openTargetWidth(null, null, null)).toBe(defaultOpenWidth)
  })

  test('other view types use the saved content width when above threshold', () => {
    expect(openTargetWidth('sideview', 66, 40)).toBe(40)
  })

  test('other view types ignore the artifact width entirely', () => {
    expect(openTargetWidth('sideview', 90, null)).toBe(defaultOpenWidth)
  })

  test('saved artifact width below the minimum threshold falls back to the artifact default', () => {
    expect(openTargetWidth('artifact', minimumWidthThreshold - 1, null)).toBe(defaultArtifactOpenWidth)
  })

  test('saved content width below the minimum threshold falls back to the content default', () => {
    expect(openTargetWidth('sideview', null, minimumWidthThreshold - 1)).toBe(defaultOpenWidth)
  })

  test('saved width exactly at the minimum threshold is honored, not treated as below it', () => {
    expect(openTargetWidth('artifact', minimumWidthThreshold, null)).toBe(minimumWidthThreshold)
    expect(openTargetWidth('sideview', null, minimumWidthThreshold)).toBe(minimumWidthThreshold)
  })

  test('artifact on a wide viewport is capped to the max pixel width', () => {
    // 66% default width on a 2400px viewport would be 1584px; capped to 1080px => 45%.
    expect(openTargetWidth('artifact', null, null, 2400)).toBe((artifactMaxWidthPx / 2400) * 100)
    expect(openTargetWidth('artifact', null, null, 2400)).toBe(45)
  })

  test('artifact on a narrow viewport is not capped when the percentage stays under the pixel cap', () => {
    // 66% of 1400px is 924px, under the 1080px cap, so it stays at 66%.
    expect(openTargetWidth('artifact', null, null, 1400)).toBe(defaultArtifactOpenWidth)
  })

  test('non-artifact view types ignore viewportWidth entirely', () => {
    expect(openTargetWidth('sideview', null, null, 100)).toBe(defaultOpenWidth)
    expect(openTargetWidth('preview', null, 90, 100)).toBe(90)
  })
})
