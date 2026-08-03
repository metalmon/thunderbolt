/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import { buildSystemInstruction } from './prompts'

describe('buildSystemInstruction', () => {
  test('ru returns the ru functional base', () => {
    const result = buildSystemInstruction({ lang: 'ru', personality: '', contextMessages: [] })
    expect(result).toContain('голосовой ко-пилот')
    expect(result).not.toContain('realtime voice co-pilot')
  })

  test('en returns the en functional base', () => {
    const result = buildSystemInstruction({ lang: 'en', personality: '', contextMessages: [] })
    expect(result).toContain('realtime voice co-pilot')
    expect(result).not.toContain('голосовой ко-пилот')
  })

  test('base always instructs synthesizing a submit_prompt request (not a verbatim transcript)', () => {
    for (const lang of ['ru', 'en'] as const) {
      const result = buildSystemInstruction({ lang, personality: '', contextMessages: [] })
      expect(result).toContain('submit_prompt')
      // Explicitly forbids a verbatim transcript — synthesized only.
      expect(result.toLowerCase()).toMatch(/synthesized|синтезированн/)
    }
  })

  test('non-empty personality is appended after the base', () => {
    const personality = 'Speak like a laid-back surfer.'
    const result = buildSystemInstruction({ lang: 'en', personality, contextMessages: [] })
    const base = buildSystemInstruction({ lang: 'en', personality: '', contextMessages: [] })
    expect(result.startsWith(base)).toBe(true)
    expect(result.indexOf(personality)).toBeGreaterThan(result.indexOf(base) + base.length - 1)
  })

  test('whitespace-only personality is treated as empty (absent, not appended)', () => {
    const result = buildSystemInstruction({ lang: 'en', personality: '   ', contextMessages: [] })
    const base = buildSystemInstruction({ lang: 'en', personality: '', contextMessages: [] })
    expect(result).toBe(base)
  })

  test('non-empty contextMessages appends the КОНТЕКСТ БЕСЕДЫ block last', () => {
    const contextMessages = [
      { role: 'user', text: 'Найди мне рецепт борща' },
      { role: 'assistant', text: 'Вот рецепт...' },
    ]
    const result = buildSystemInstruction({ lang: 'ru', personality: 'Будь краток.', contextMessages })
    expect(result).toContain('=== КОНТЕКСТ БЕСЕДЫ ===')
    expect(result.indexOf('=== КОНТЕКСТ БЕСЕДЫ ===')).toBeGreaterThan(result.indexOf('Будь краток.'))
    expect(result.endsWith('assistant: Вот рецепт...')).toBe(true)
  })

  test('empty contextMessages appends nothing', () => {
    const withEmpty = buildSystemInstruction({ lang: 'en', personality: 'Be terse.', contextMessages: [] })
    expect(withEmpty).not.toContain('КОНТЕКСТ БЕСЕДЫ')
    expect(withEmpty.endsWith('Be terse.')).toBe(true)
  })
})
