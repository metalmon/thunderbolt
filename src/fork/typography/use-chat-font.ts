/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { useSettings } from '@/hooks/use-settings'
import { useEffect } from 'react'

/** 'lora' (default) = the bundled serif (Plantin Cyr MT, surfaced as "Lora" in the UI);
 *  'system' = the app's sans stack. */
export type ChatFont = 'lora' | 'system'

/**
 * Chat reading-font preference. Reads the synced `chat_font` setting; defaults to
 * 'lora' when unset. NOT seeded into defaultSettings (so nothing touches the shared
 * defaultSettingsVersion — clean rollback), mirroring the collapse-reasoning toggle.
 */
export const useChatFont = (): ChatFont =>
  useSettings({ chat_font: 'lora' }).chatFont.value === 'system' ? 'system' : 'lora'

/** Chat prose size scale. 'medium' (default) is the comfortable base; 'small'/'large'
 *  nudge the size down/up (see chat-font.css). Synced, not seeded — like chat_font. */
export type ChatFontSize = 'small' | 'medium' | 'large'

export const useChatFontSize = (): ChatFontSize => {
  const value = useSettings({ chat_font_size: 'medium' }).chatFontSize.value
  return value === 'small' ? 'small' : value === 'large' ? 'large' : 'medium'
}

/**
 * Mount once near the app root. Reflects the chat-font preference onto
 * `<html data-chat-font>`, which flips the `--font-chat` CSS var (see chat-font.css).
 * Renders nothing. Setting a document-root attribute from state is a legitimate DOM
 * side effect, hence the effect.
 */
export const ChatFontApplier = (): null => {
  const font = useChatFont()
  const size = useChatFontSize()
  useEffect(() => {
    document.documentElement.dataset.chatFont = font
    document.documentElement.dataset.chatFontSize = size
  }, [font, size])
  return null
}
