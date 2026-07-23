/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSettings } from '@/hooks/use-settings'
import { useTranslation } from 'react-i18next'

/**
 * Preferences row for the chat reading font. Options: System (sans) and "Lora" (the
 * bundled Plantin Cyr MT serif — labelled Lora per product choice). Self-contained
 * (leading divider + label + select) so the invasive seam in preferences.tsx is one
 * line. Not seeded into defaultSettings — see use-chat-font.
 */
export const ChatFontToggle = () => {
  const { t } = useTranslation('settings')
  const { chatFont } = useSettings({ chat_font: 'lora' })
  const value = chatFont.value === 'system' ? 'system' : 'lora'

  return (
    <>
      <div className="h-px bg-border -mx-6" />

      <div className="flex-row flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium">{t('preferences.chatFontLabel')}</label>
          <p className="text-sm text-muted-foreground">{t('preferences.chatFontDescription')}</p>
        </div>
        <Select value={value} onValueChange={(next) => void chatFont.setValue(next)}>
          <SelectTrigger className="w-36" aria-label={t('preferences.chatFontLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lora">{t('preferences.chatFontLora')}</SelectItem>
            <SelectItem value="system">{t('preferences.chatFontSystem')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  )
}
