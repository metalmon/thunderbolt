/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import dayjs from '@/lib/dayjs'

import enCommon from '../../locales/en/common.json'
import enSettings from '../../locales/en/settings.json'
import enChat from '../../locales/en/chat.json'
import enAuth from '../../locales/en/auth.json'
import enOnboarding from '../../locales/en/onboarding.json'
import enTasks from '../../locales/en/tasks.json'
import enProjects from '../../locales/en/projects.json'
import enDefaults from '../../locales/en/defaults.json'

import ruCommon from '../../locales/ru/common.json'
import ruSettings from '../../locales/ru/settings.json'
import ruChat from '../../locales/ru/chat.json'
import ruAuth from '../../locales/ru/auth.json'
import ruOnboarding from '../../locales/ru/onboarding.json'
import ruTasks from '../../locales/ru/tasks.json'
import ruProjects from '../../locales/ru/projects.json'
import ruDefaults from '../../locales/ru/defaults.json'

import { detectUiLanguage, normalizeUiLanguage, type UiLanguage } from './languages'

export const I18N_NAMESPACES = ['common', 'settings', 'chat', 'auth', 'onboarding', 'tasks', 'projects', 'defaults'] as const

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      settings: enSettings,
      chat: enChat,
      auth: enAuth,
      onboarding: enOnboarding,
      tasks: enTasks,
      projects: enProjects,
      defaults: enDefaults,
    },
    ru: {
      common: ruCommon,
      settings: ruSettings,
      chat: ruChat,
      auth: ruAuth,
      onboarding: ruOnboarding,
      tasks: ruTasks,
      projects: ruProjects,
      defaults: ruDefaults,
    },
  },
  lng: detectUiLanguage(typeof navigator !== 'undefined' ? navigator.language : 'en'),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: [...I18N_NAMESPACES],
  interpolation: { escapeValue: false },
  returnNull: false,
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: import.meta.env.DEV
    ? (_lngs, ns, key) => {
        console.warn(`[i18n] missing key ${ns}:${key}`)
      }
    : false,
})

// Keep dayjs's locale in sync with the UI language so relative/absolute dates
// (`.fromNow()`, day/month names) render in the active language instead of English
// (e.g. "Доступен a few seconds ago" → "Доступен несколько секунд назад").
const syncDayjsLocale = (lng: string): void => {
  dayjs.locale(normalizeUiLanguage(lng) === 'ru' ? 'ru' : 'en')
}
syncDayjsLocale(i18n.language)
i18n.on('languageChanged', syncDayjsLocale)

export const setUiLanguage = (language: string): UiLanguage => {
  const normalized = normalizeUiLanguage(language)
  void i18n.changeLanguage(normalized)
  return normalized
}

export default i18n
