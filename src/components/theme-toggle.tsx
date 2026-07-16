/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTheme } from '@/lib/theme-provider'
import { trackEvent } from '@/lib/posthog'

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation('settings')

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={theme}
      onValueChange={(value) => {
        if (!value) {
          return
        }
        setTheme(value as 'light' | 'dark' | 'system')
        trackEvent('settings_theme_set', { theme: value })
      }}
      className="justify-start rounded-lg"
    >
      <ToggleGroupItem
        value="light"
        aria-label={t('preferences.themeLight')}
        className="gap-2 px-4 cursor-pointer first:rounded-l-lg last:rounded-r-lg"
      >
        <Sun className="h-4 w-4" />
        {t('preferences.themeLight')}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        aria-label={t('preferences.themeDark')}
        className="gap-2 px-4 cursor-pointer first:rounded-l-lg last:rounded-r-lg"
      >
        <Moon className="h-4 w-4" />
        {t('preferences.themeDark')}
      </ToggleGroupItem>
      <ToggleGroupItem
        value="system"
        aria-label={t('preferences.themeSystem')}
        className="gap-2 px-4 cursor-pointer first:rounded-l-lg last:rounded-r-lg"
      >
        <Monitor className="h-4 w-4" />
        {t('preferences.themeSystem')}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
