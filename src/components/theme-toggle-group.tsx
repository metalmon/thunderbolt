/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useTranslation } from 'react-i18next'

import { isTheme, themeIcons } from '@/components/theme-icons'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useTheme } from '@/lib/theme-provider'
import { trackEvent } from '@/lib/posthog'

/** Three-way Light / Dark / System theme picker for the Preferences page. */
const themeOptions = [
  { value: 'light', ariaKey: 'preferences.themeLightAria', Icon: themeIcons.light, labelKey: 'preferences.themeLight' },
  { value: 'dark', ariaKey: 'preferences.themeDarkAria', Icon: themeIcons.dark, labelKey: 'preferences.themeDark' },
  {
    value: 'system',
    ariaKey: 'preferences.themeSystemAria',
    Icon: themeIcons.system,
    labelKey: 'preferences.themeSystem',
  },
  {
    value: 'paper',
    ariaKey: 'preferences.themePaperAria',
    Icon: themeIcons.paper,
    labelKey: 'preferences.themePaper',
  },
] as const

export const ThemeToggleGroup = () => {
  const { t } = useTranslation('settings')
  const { theme, setTheme } = useTheme()

  // Four themes overflow one row on narrow screens (RU labels are long), so the
  // group is laid out 2×2 on mobile and 1×4 on desktop: grid/w-full override the
  // ui component's `flex w-fit` (which never wraps), and each item forces
  // rounded-lg + a restored left border so it reads as a standalone pill across
  // the grid gap (the outline variant's segment-connect border is moot gridded).
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={theme}
      onValueChange={(value) => {
        // Radix reports '' when the active item is clicked again — ignore it.
        if (!isTheme(value)) {
          return
        }
        setTheme(value)
        trackEvent('settings_theme_set', { theme: value })
      }}
      className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {themeOptions.map(({ value, ariaKey, Icon, labelKey }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={t(ariaKey)}
          className="gap-2 px-4 cursor-pointer justify-center rounded-lg! data-[variant=outline]:border-l!"
        >
          <Icon className="h-4 w-4" />
          {t(labelKey)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
