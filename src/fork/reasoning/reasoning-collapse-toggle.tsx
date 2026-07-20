/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { Switch } from '@/components/ui/switch'
import { useSettings } from '@/hooks/use-settings'
import { useTranslation } from 'react-i18next'

/**
 * Preferences row for the "collapse reasoning by default" setting. Self-contained
 * (leading divider + label + switch) so the invasive seam in preferences.tsx is a
 * single `<ReasoningCollapseToggle />`. Mirrors the haptics row in the User
 * Experience section.
 *
 * Deliberately has no reset-to-default chip: the setting is intentionally NOT
 * seeded into `defaultSettings`, so nothing touches the shared reconciled
 * `defaultSettingsVersion` (keeps this fork feature conflict-free against upstream
 * settings changes and trivially removable). `useSettings` supplies the `true`
 * fallback when no row exists.
 */
export const ReasoningCollapseToggle = () => {
  const { t } = useTranslation('settings')
  const { collapseReasoningByDefault } = useSettings({ collapse_reasoning_by_default: true })

  return (
    <>
      <div className="h-px bg-border -mx-6" />

      <div className="flex-row flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium">{t('preferences.collapseReasoningLabel')}</label>
          <p className="text-sm text-muted-foreground">{t('preferences.collapseReasoningDescription')}</p>
        </div>
        <Switch
          checked={collapseReasoningByDefault.value}
          onCheckedChange={(value) => void collapseReasoningByDefault.setValue(value)}
          aria-label={t('preferences.collapseReasoningLabel')}
        />
      </div>
    </>
  )
}
