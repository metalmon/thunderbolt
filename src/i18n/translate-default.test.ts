/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, test } from 'bun:test'
import type { TFunction } from 'i18next'
import { translateDefaultField } from './translate-default'

const t = ((key: string, opts?: { defaultValue?: string }) => {
  if (key === 'modes.mode-chat.label') return 'Чат'
  if (key === 'agents.thunderbolt-built-in.description') return 'Встроенный ИИ-ассистент'
  return opts?.defaultValue ?? key
}) as TFunction

describe('translateDefaultField', () => {
  test('translates builtin mode label', () => {
    expect(translateDefaultField(t, 'modes', 'mode-chat', 'label', 'Chat')).toBe('Чат')
  })

  test('falls back for missing translation key', () => {
    expect(translateDefaultField(t, 'modes', 'mode-search', 'label', 'Search')).toBe('Search')
  })

  test('returns fallback for non-builtin id', () => {
    expect(translateDefaultField(t, 'modes', 'mode-custom', 'label', 'Custom')).toBe('Custom')
  })

  test('translates builtin agent description', () => {
    expect(translateDefaultField(t, 'agents', 'thunderbolt-built-in', 'description', 'Built-in AI assistant')).toBe(
      'Встроенный ИИ-ассистент',
    )
  })

  test('returns fallback for non-builtin agent id', () => {
    expect(translateDefaultField(t, 'agents', 'custom-agent', 'description', 'Custom')).toBe('Custom')
  })
})
