/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getI18n, resolveCliLocale } from './i18n.ts'

// A stub for the OS language, so the tests do not depend on the machine running
// them. The real one reads `Intl`.
const system = (tag: string | undefined) => () => tag

describe('resolveCliLocale', () => {
  // The case that makes this a product rather than a setting: a person installs
  // the binary on a Russian Windows and it speaks Russian, with nothing to set.
  it('follows the operating system when nothing is set', () => {
    expect(resolveCliLocale({}, system('ru-RU'))).toBe('ru')
    expect(resolveCliLocale({}, system('en-GB'))).toBe('en')
  })

  // ⚠ Measured, not assumed: Git Bash exports LANG=en_US.UTF-8 on Windows by
  // itself. Trusting it over the system language handed every Russian Windows
  // user an English interface.
  it('prefers the system language over a shell-provided LANG', () => {
    expect(resolveCliLocale({ LANG: 'en_US.UTF-8' }, system('ru-RU'))).toBe('ru')
  })

  // The override has to win in BOTH directions, or it is not an override.
  it('lets the explicit variable force a language against the system', () => {
    expect(resolveCliLocale({ VOLT_LANG: 'en' }, system('ru-RU'))).toBe('en')
    expect(resolveCliLocale({ VOLT_LANG: 'ru' }, system('en-US'))).toBe('ru')
  })

  // When the runtime reports nothing (a trimmed ICU, say), POSIX still answers.
  it('falls back to POSIX variables when the runtime reports no locale', () => {
    expect(resolveCliLocale({ LC_ALL: 'ru_RU.UTF-8' }, system(undefined))).toBe('ru')
  })

  // The dedicated variable comes first because Windows sets neither LANG nor
  // LC_ALL, so it is the only way to ask for Russian there.
  it('prefers the dedicated variable over POSIX locale vars', () => {
    expect(resolveCliLocale({ VOLT_LANG: 'ru', LANG: 'en_US.UTF-8' }, system('en-US'))).toBe('ru')
  })

  it('honours the legacy spelling of the dedicated variable', () => {
    expect(resolveCliLocale({ THUNDERBOLT_LANG: 'ru' }, system('en-US'))).toBe('ru')
  })

  // What a Linux or macOS user already has set, and what a terminal tool is
  // expected to read.
  it.each(['ru', 'ru_RU', 'ru_RU.UTF-8', 'ru-RU'])('matches the base language of %s', (tag) => {
    expect(resolveCliLocale({ LANG: tag }, system(undefined))).toBe('ru')
    expect(resolveCliLocale({ LC_ALL: tag }, system(undefined))).toBe('ru')
  })

  it('falls back to English for an unshipped language and for nothing at all', () => {
    expect(resolveCliLocale({ LANG: 'de_DE.UTF-8' }, system(undefined))).toBe('en')
    expect(resolveCliLocale({}, system(undefined))).toBe('en')
  })
})

describe('catalogs', () => {
  it('renders Russian with interpolation', () => {
    const rendered = getI18n('ru')._({
      id: 'Revoking this {app} CLI device…',
      values: { app: 'Volt' },
    })
    expect(rendered).toBe('Отзываю это устройство Volt CLI…')
  })

  // The source locale returns the id, so a missing English catalog entry is
  // invisible — this pins that the compiled catalog is actually wired, not that
  // the fallback happens to produce the same text.
  it('renders English from the compiled catalog, not from the id', () => {
    const rendered = getI18n('en')._({ id: 'Revoking this {app} CLI device…', values: { app: 'Volt' } })
    expect(rendered).toBe('Revoking this Volt CLI device…')
  })

  it('memoizes one instance per locale', () => {
    expect(getI18n('ru')).toBe(getI18n('ru'))
  })
})

describe('the macro ban', () => {
  // ⚠ Bun has no Babel pass, so `@lingui/core/macro` resolves to Lingui's stub
  // and THROWS when called. A macro here would surface first in a shipped
  // binary, on whichever path happened to use it — exactly the trap the
  // backend's email copy documents. Cheap, direct, and catches a well-meaning
  // "modernisation" of a string.
  it('no source file imports a lingui macro', () => {
    // ⚠ Anchored on this file, NOT on an absolute path and NOT on the CWD.
    // It carried `C:/dev/thunderbolt/cli` — one developer's machine — so it
    // passed there and failed everywhere else, including CI, where it was the
    // first thing to break the CLI release.
    const cliRoot = join(import.meta.dir, '..', '..')
    const offenders = new Bun.Glob('src/**/*.ts').scanSync({ cwd: cliRoot })
    const bad: string[] = []
    for (const file of offenders) {
      const source = readFileSync(join(cliRoot, file), 'utf8')
      // An IMPORT, not any mention: this file and `i18n.ts` both name the macro
      // paths in prose to explain why they are banned, and a substring check
      // would flag the explanation itself.
      if (/from\s+'@lingui\/(?:core|react)\/macro'/.test(source)) {
        bad.push(file)
      }
    }
    expect(bad).toEqual([])
  })
})
