/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSettings } from '@/hooks/use-settings'
import { useTranslation } from 'react-i18next'

/**
 * Preferences rows for the chat reading font + its size.
 * - Font: System (sans) vs "Lora" (the bundled Plantin Cyr MT serif — labelled Lora
 *   per product choice).
 * - Size: Small / Medium / Large scale on the chat prose (the serif also carries a
 *   small built-in bump so it doesn't read too small — see chat-font.css).
 * Self-contained (leading divider + two rows) so the preferences seam stays one line.
 * Neither setting is seeded into defaultSettings — see use-chat-font.
 */
export const ChatFontToggle = () => {
  const { t } = useTranslation('settings')
  const { chatFont, chatFontSize } = useSettings({ chat_font: 'lora', chat_font_size: 'medium' })
  const font = chatFont.value === 'system' ? 'system' : 'lora'
  const size = chatFontSize.value === 'small' ? 'small' : chatFontSize.value === 'large' ? 'large' : 'medium'

  return (
    <>
      <div className="h-px bg-border -mx-6" />

      <div className="flex-row flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium">{t('preferences.chatFontLabel')}</label>
          <p className="text-sm text-muted-foreground">{t('preferences.chatFontDescription')}</p>
        </div>
        <Select value={font} onValueChange={(next) => void chatFont.setValue(next)}>
          <SelectTrigger className="w-36" aria-label={t('preferences.chatFontLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lora">{t('preferences.chatFontLora')}</SelectItem>
            <SelectItem value="system">{t('preferences.chatFontSystem')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-row flex items-center gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium">{t('preferences.chatFontSizeLabel')}</label>
          <p className="text-sm text-muted-foreground">{t('preferences.chatFontSizeDescription')}</p>
        </div>
        <Select value={size} onValueChange={(next) => void chatFontSize.setValue(next)}>
          <SelectTrigger className="w-36" aria-label={t('preferences.chatFontSizeLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="small">{t('preferences.chatFontSizeSmall')}</SelectItem>
            <SelectItem value="medium">{t('preferences.chatFontSizeMedium')}</SelectItem>
            <SelectItem value="large">{t('preferences.chatFontSizeLarge')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  )
}
