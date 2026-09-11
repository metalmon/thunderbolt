/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { buildThemeStyleTag, resolveArtifactColorScheme } from './theme-tokens'

describe('buildThemeStyleTag', () => {
  it('emits only tokens with a non-empty value', () => {
    const tag = buildThemeStyleTag(
      { '--color-background': 'oklch(1 0 0)', '--color-foreground': '', '--radius': '0.5rem' },
      'light',
    )
    expect(tag).toContain('--color-background: oklch(1 0 0) !important;')
    expect(tag).toContain('--radius: 0.5rem !important;')
    expect(tag).not.toContain('--color-foreground')
  })

  it('marks every emitted declaration !important so an agent :root{} cannot win the cascade', () => {
    const tag = buildThemeStyleTag({ '--color-primary': '#000', '--color-border': '#111' }, 'dark')
    expect(tag).toContain('--color-primary: #000 !important;')
    expect(tag).toContain('--color-border: #111 !important;')
  })

  it('always emits color-scheme, even with no resolved tokens', () => {
    const empty = buildThemeStyleTag({}, 'dark')
    expect(empty).toContain('color-scheme: dark;')
    expect(empty).toBe('<style>:root {  color-scheme: dark; }</style>')

    const light = buildThemeStyleTag({}, 'light')
    expect(light).toContain('color-scheme: light;')
  })

  it('wraps the declarations in a single <style>:root{} block', () => {
    const tag = buildThemeStyleTag({ '--color-accent': 'red' }, 'light')
    expect(tag.startsWith('<style>:root {')).toBe(true)
    expect(tag.endsWith('}</style>')).toBe(true)
  })

  it('ignores keys that are not recognized theme tokens', () => {
    const tag = buildThemeStyleTag({ '--not-a-theme-token': 'x', '--color-ring': 'blue' }, 'light')
    expect(tag).not.toContain('--not-a-theme-token')
    expect(tag).toContain('--color-ring: blue !important;')
  })
})

describe('resolveArtifactColorScheme', () => {
  it('maps dark to dark', () => {
    expect(resolveArtifactColorScheme('dark')).toBe('dark')
  })

  it('maps light to light', () => {
    expect(resolveArtifactColorScheme('light')).toBe('light')
  })

  it('maps paper (a fixed light-ish theme) to light', () => {
    expect(resolveArtifactColorScheme('paper')).toBe('light')
  })
})
