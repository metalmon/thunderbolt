/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { detectUiLanguage, normalizeUiLanguage, type UiLanguage } from './languages'

export type ResolveInitialUiLanguageResult = {
  language: UiLanguage
  shouldPersist: boolean
}

export const resolveInitialUiLanguage = (input: {
  stored: string | null | undefined
  locale: string | null | undefined
}): ResolveInitialUiLanguageResult => {
  if (input.stored != null && input.stored !== '') {
    return { language: normalizeUiLanguage(input.stored), shouldPersist: false }
  }
  return { language: detectUiLanguage(input.locale), shouldPersist: true }
}

export const readClientLocale = (): string => (typeof navigator !== 'undefined' ? navigator.language : 'en')
