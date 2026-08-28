/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'

import { generateTitle } from './title-generator'

describe('generateTitle', () => {
  it('sentence-cases without Title-Casing every word', () => {
    expect(generateTitle('fix the login bug')).toBe('Fix the login bug')
  })

  it("preserves the author's casing for acronyms and code", () => {
    expect(generateTitle('use the API to parse JSON')).toBe('Use the API to parse JSON')
  })

  it('keeps Russian text intact (no shouty per-word caps)', () => {
    expect(generateTitle('исправить склонение чатов в проекте')).toBe('Исправить склонение чатов в проекте')
  })

  it('does not drop short words from the middle of the phrase', () => {
    // The old length>2 filter would have yielded "Add User Roles".
    expect(generateTitle('add a user to the roles')).toBe('Add a user to the roles')
  })

  it('strips a leading English opener', () => {
    expect(generateTitle('How do I reset my password')).toBe('Do I reset my password')
  })

  it('trims edge punctuation but keeps internal punctuation', () => {
    expect(generateTitle("don't break the build!")).toBe("Don't break the build")
  })

  it('limits to the requested word count', () => {
    expect(generateTitle('one two three four five six seven eight', { words: 3 })).toBe('One two three')
  })

  it('truncates long titles at a word boundary within 50 chars', () => {
    const title = generateTitle('aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffffff')
    expect(title.length).toBeLessThanOrEqual(50)
    expect(title.endsWith(' ')).toBe(false)
  })

  it('falls back to New Chat for empty or blank input', () => {
    expect(generateTitle('')).toBe('New Chat')
    expect(generateTitle('   \n  ')).toBe('New Chat')
  })
})
