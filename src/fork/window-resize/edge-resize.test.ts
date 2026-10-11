/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { edgeDirectionAt } from './edge-resize'

const width = 1400
const height = 900

describe('edgeDirectionAt', () => {
  it('returns null for presses away from every edge', () => {
    expect(edgeDirectionAt(400, 300, width, height)).toBeNull()
    expect(edgeDirectionAt(700, 450, width, height)).toBeNull()
  })

  it('classifies the four edges', () => {
    expect(edgeDirectionAt(2, 300, width, height)).toBe('West')
    expect(edgeDirectionAt(width - 3, 300, width, height)).toBe('East')
    expect(edgeDirectionAt(400, 2, width, height)).toBe('North')
    expect(edgeDirectionAt(400, height - 3, width, height)).toBe('South')
  })

  it('classifies the four corners (corners win over single edges)', () => {
    expect(edgeDirectionAt(2, 2, width, height)).toBe('NorthWest')
    expect(edgeDirectionAt(width - 3, 2, width, height)).toBe('NorthEast')
    expect(edgeDirectionAt(2, height - 3, width, height)).toBe('SouthWest')
    expect(edgeDirectionAt(width - 3, height - 3, width, height)).toBe('SouthEast')
  })

  it('treats the band as exclusive: x < zone on the west, x >= width - zone on the east', () => {
    expect(edgeDirectionAt(3, 400, width, height)).toBe('West')
    expect(edgeDirectionAt(6, 400, width, height)).toBeNull()
    expect(edgeDirectionAt(width - 6, 400, width, height)).toBe('East')
    expect(edgeDirectionAt(width - 7, 400, width, height)).toBeNull()
  })

  it('honours a custom zone', () => {
    expect(edgeDirectionAt(10, 400, width, height, 12)).toBe('West')
    expect(edgeDirectionAt(12, 400, width, height, 12)).toBeNull()
  })
})
