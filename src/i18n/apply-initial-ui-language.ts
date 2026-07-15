/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { setUiLanguage } from './i18n'
import { readClientLocale, resolveInitialUiLanguage } from './ensure-ui-language'

let applyPromise: Promise<void> | null = null

export const applyInitialUiLanguageIfNeeded = async (input: {
  stored: string | null | undefined
  setValue: (value: string) => Promise<unknown>
}): Promise<void> => {
  if (applyPromise) return applyPromise

  applyPromise = (async () => {
    const { language, shouldPersist } = resolveInitialUiLanguage({
      stored: input.stored,
      locale: readClientLocale(),
    })
    if (!shouldPersist) {
      setUiLanguage(language)
      return
    }
    await input.setValue(language)
    setUiLanguage(language)
  })()

  try {
    await applyPromise
  } catch (error) {
    applyPromise = null
    throw error
  }
}

/** @internal test-only — clears in-flight dedup state between test cases */
export const resetApplyInitialUiLanguageForTests = (): void => {
  applyPromise = null
}
