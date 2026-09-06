/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { defaultSkills } from './skills'
import { defaultSkillsRu } from './skills-ru'

// NOTE: this file is asserted against the *assembled* tree. On the isolated
// fork/i18n branch `defaultSkills` still contains `say` (removed later on
// fork/voice-gemini-live), so we assert RU is a well-formed SUBSET of EN by id
// rather than an exact length match.

describe('defaultSkillsRu', () => {
  const enById = new Map(defaultSkills.map((s) => [s.id, s]))

  it('ships the nine non-voice built-in skills, all Cyrillic-slugged', () => {
    expect(defaultSkillsRu).toHaveLength(9)
    for (const skill of defaultSkillsRu) {
      expect(skill.name).toMatch(/[а-яё]/i) // Russian slug
      expect(skill.name).not.toMatch(/[a-z]/i) // no Latin leftover
      expect(skill.label).toBeTruthy()
      expect(skill.description).toBeTruthy()
      expect(skill.instruction).toBeTruthy()
    }
  })

  it('reuses the exact English skill ids (so reconcile matches rows by id) and excludes `say`', () => {
    for (const ru of defaultSkillsRu) {
      expect(enById.has(ru.id)).toBe(true) // every RU id is a known EN id
    }
    // `say` must not be present (feature removed).
    expect(defaultSkillsRu.some((s) => s.name === 'say' || s.name === 'сэй')).toBe(false)
    // No duplicate ids.
    expect(new Set(defaultSkillsRu.map((s) => s.id)).size).toBe(defaultSkillsRu.length)
  })

  it('preserves each skill’s enabled/pinnedOrder from its English twin (structural, not content)', () => {
    for (const ru of defaultSkillsRu) {
      const en = enById.get(ru.id)!
      expect(ru.enabled).toBe(en.enabled)
      expect(ru.pinnedOrder).toBe(en.pinnedOrder)
    }
  })

  it('keeps widget tag syntax intact in translated instructions (prose-only translation)', () => {
    const search = defaultSkillsRu.find((s) => s.name === 'поиск')!
    expect(search.instruction).toContain('<widget:link-preview source="N" url="https://..." />')
    const weather = defaultSkillsRu.find((s) => s.name === 'погода')!
    expect(weather.instruction).toContain('<widget:weather-forecast location="Seattle"')
    const ask = defaultSkillsRu.find((s) => s.name === 'опрос')!
    expect(ask.instruction).toContain('"id":"a","text":"SMTP","isCorrect":true')
  })
})
