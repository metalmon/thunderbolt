/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { isSearchableSegment } from './segment-word-like'

describe('isSearchableSegment', () => {
  it('keeps what the engine calls word-like', () => {
    expect(isSearchableSegment({ segment: '確率', isWordLike: true })).toBe(true)
  })

  it('keeps digits even where the engine says they are not word-like', () => {
    // Bun's ICU reports exactly this for a pure-digit run; Chromium reports true.
    expect(isSearchableSegment({ segment: '100', isWordLike: false })).toBe(true)
  })

  it('keeps a mixed run such as a version or a model name', () => {
    expect(isSearchableSegment({ segment: 'gpt4', isWordLike: false })).toBe(true)
  })

  it('still drops punctuation and whitespace, which is all the filter is for', () => {
    expect(isSearchableSegment({ segment: '%', isWordLike: false })).toBe(false)
    expect(isSearchableSegment({ segment: ' ', isWordLike: false })).toBe(false)
    expect(isSearchableSegment({ segment: '—', isWordLike: false })).toBe(false)
  })

  it('treats a missing isWordLike as absent evidence, not as a veto', () => {
    expect(isSearchableSegment({ segment: '42' })).toBe(true)
    expect(isSearchableSegment({ segment: '!' })).toBe(false)
  })
})
