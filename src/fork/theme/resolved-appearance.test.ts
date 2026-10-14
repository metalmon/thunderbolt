import { describe, expect, it } from 'bun:test'

import { resolveAppearance } from './resolved-appearance'

describe('resolveAppearance', () => {
  it('keeps paper as its own appearance', () => {
    // The bug this file exists for: paper used to resolve through the OS media
    // query, so a paper user on a dark OS got a dark panel inside a warm client.
    expect(resolveAppearance('paper', 'dark')).toBe('paper')
    expect(resolveAppearance('paper', 'light')).toBe('paper')
  })

  it('passes an explicit light or dark through', () => {
    expect(resolveAppearance('light', 'light')).toBe('light')
    expect(resolveAppearance('dark', 'dark')).toBe('dark')
  })

  it('lets system follow whatever the OS resolved to', () => {
    expect(resolveAppearance('system', 'dark')).toBe('dark')
    expect(resolveAppearance('system', 'light')).toBe('light')
  })
})
