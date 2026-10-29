/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, saveConfig } from '../config/config.ts'
import type { ProviderCommand, ProviderRuntime } from '../provider-runtime/types.ts'
import { chooseLanguage } from './language-command.ts'
import { applyCliLanguage, i18n } from './i18n.ts'

const bootLocale = i18n.locale
afterEach(() => {
  i18n.activate(bootLocale)
})

const withConfigFile = async (contents: string): Promise<string> => {
  const path = join(await mkdtemp(join(tmpdir(), 'volt-language-')), 'config.json')
  await writeFile(path, contents, 'utf8')
  return path
}

const validConfig = {
  version: 3 as const,
  activeProviderId: null,
  thunderbolt: { defaultModelId: '00000000-0000-4000-8000-000000000000' },
  providers: [],
}

describe('language setting', () => {
  test('a config written before the field existed stays valid', async () => {
    const path = await withConfigFile(`${JSON.stringify(validConfig, null, 2)}\n`)
    const loaded = await loadConfig(path)
    expect(loaded?.version).toBe(3)
    expect(loaded?.language).toBeUndefined()
  })

  test('a stored language round-trips', async () => {
    const path = await withConfigFile(`${JSON.stringify({ ...validConfig, language: 'ru' }, null, 2)}\n`)
    const loaded = await loadConfig(path)
    expect(loaded?.language).toBe('ru')
    await saveConfig({ ...validConfig, language: 'en' }, path)
    expect(JSON.parse(await readFile(path, 'utf8')).language).toBe('en')
  })

  test('a language the binary does not ship is rejected rather than ignored', async () => {
    const path = await withConfigFile(`${JSON.stringify({ ...validConfig, language: 'de' }, null, 2)}\n`)
    expect(loadConfig(path)).rejects.toThrow(/invalid/)
  })

  test('an unknown key is still rejected — the schema stayed strict', async () => {
    const path = await withConfigFile(`${JSON.stringify({ ...validConfig, nonsense: 1 }, null, 2)}\n`)
    expect(loadConfig(path)).rejects.toThrow(/invalid/)
  })

  test('applying a preference switches the catalog, and `system` returns to the environment', () => {
    applyCliLanguage('ru')
    expect(i18n.locale).toBe('ru')
    expect(i18n._({ id: 'Interface language' })).toBe('Язык интерфейса')
    applyCliLanguage('en')
    expect(i18n.locale).toBe('en')
    expect(i18n._({ id: 'Interface language' })).toBe('Interface language')
    applyCliLanguage('system')
    // `src/fork/test-locale.ts` pins VOLT_LANG=en for the suite, so "system"
    // here means the preloaded override rather than this machine's language.
    expect(i18n.locale).toBe('en')
  })

  test('absence means `system`, not English', () => {
    applyCliLanguage('ru')
    applyCliLanguage(undefined)
    expect(i18n.locale).toBe('en')
  })
})

describe('language picker', () => {
  test('persists the choice through the runtime and confirms in the new language', async () => {
    const written: string[] = []
    const managed: unknown[] = []
    const outcome = await chooseLanguage(
      {
        choose: async (_title, items) => items[2]?.id ?? null,
        readText: async () => null,
        readSecret: async () => null,
        write: (text) => written.push(text),
        showVerification: () => {},
        showStatus: () => {},
      },
      { manage: async (command: ProviderCommand) => void managed.push(command) } as unknown as ProviderRuntime,
    )
    expect(outcome).toEqual({ kind: 'handled' })
    expect(managed).toEqual([{ type: 'set-language', language: 'ru' }])
    expect(written.join('')).toContain('Язык интерфейса сохранён.')
  })

  test('a cancelled picker writes nothing', async () => {
    const managed: unknown[] = []
    await chooseLanguage(
      {
        choose: async () => null,
        readText: async () => null,
        readSecret: async () => null,
        write: () => {},
        showVerification: () => {},
        showStatus: () => {},
      },
      { manage: async (command: ProviderCommand) => void managed.push(command) } as unknown as ProviderRuntime,
    )
    expect(managed).toEqual([])
  })
})
