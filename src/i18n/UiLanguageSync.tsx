/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEffect } from 'react'

import { useSettings } from '@/hooks/use-settings'

import { setUiLanguage } from './i18n'
import { normalizeUiLanguage } from './languages'

/**
 * Keeps i18next in sync with the account-scoped ui_language setting.
 * Mount inside DatabaseProvider.
 */
export const UiLanguageSync = () => {
  const { uiLanguage } = useSettings({ ui_language: null })

  useEffect(() => {
    if (uiLanguage.value == null) return
    setUiLanguage(normalizeUiLanguage(uiLanguage.value))
  }, [uiLanguage.value])

  return null
}
