/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { CommandOutcome, ProviderManagerIO, ProviderRuntime } from '../provider-runtime/types.ts'
import { applyCliLanguage, i18n, type CliLanguagePreference } from './i18n.ts'

const preferences = ['system', 'en', 'ru'] as const satisfies readonly CliLanguagePreference[]
const isPreference = (value: string): value is CliLanguagePreference =>
  (preferences as readonly string[]).includes(value)

/**
 * Offers the interface language and persists the choice.
 *
 * The language NAMES are deliberately untranslated: someone looking for Russian
 * in an English interface has to recognise «Русский», and «Английский» would be
 * no help to the reverse case. Only the title and the system entry translate.
 */
export const chooseLanguage = async (io: ProviderManagerIO, runtime: ProviderRuntime): Promise<CommandOutcome> => {
  const selected = await io.choose(i18n._({ id: 'Interface language' }), [
    {
      id: 'system',
      label: i18n._({ id: 'System language' }),
      description: i18n._({ id: 'follow the operating system' }),
    },
    { id: 'en', label: 'English' },
    { id: 'ru', label: 'Русский' },
  ])
  if (selected === null || !isPreference(selected)) return { kind: 'handled' }
  await runtime.manage({ type: 'set-language', language: selected })
  // Applied by the runtime too, but repeated here so the confirmation below is
  // already in the language the user just picked.
  applyCliLanguage(selected)
  io.write(`${i18n._({ id: 'Interface language saved.' })}\n`)
  return { kind: 'handled' }
}
