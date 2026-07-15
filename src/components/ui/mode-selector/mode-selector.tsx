/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SearchableMenu, type SearchableMenuGroup, type SearchableMenuItem } from '@/components/ui/searchable-menu'
import { cn } from '@/lib/utils'
import type { Mode } from '@/types'
import { Globe, MessageCircle, Microscope } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { translateDefaultField } from '@/i18n/translate-default'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type ModeSelectorProps = {
  modes: Mode[]
  selectedMode: Mode | null
  onModeChange: (modeId: string) => void
  iconOnly?: boolean
}

// Icons share the label's muted color so each pill reads as a single unit. The
// chat mode's seeded icon token is 'message-square', but design wants the
// rounded bubble (lucide message-circle) for it.
const iconMap: Record<string, ReactNode> = {
  'message-square': <MessageCircle className="size-[var(--icon-size-default)] text-muted-foreground" />,
  globe: <Globe className="size-[var(--icon-size-default)] text-muted-foreground" />,
  microscope: <Microscope className="size-[var(--icon-size-default)] text-muted-foreground" />,
}

const getModeIcon = (iconName: string): ReactNode => {
  return iconMap[iconName] ?? <MessageCircle className="size-[var(--icon-size-default)] text-muted-foreground" />
}

type ModeItemData = {
  mode: Mode
}

export const ModeSelector = ({ modes, selectedMode, onModeChange, iconOnly = false }: ModeSelectorProps) => {
  const { isMobile } = useIsMobile()
  const { t } = useTranslation('defaults')
  const chatFallback = translateDefaultField(t, 'modes', 'mode-chat', 'label', 'Chat')
  const groupedItems = useMemo(
    (): SearchableMenuGroup<ModeItemData>[] => [
      {
        id: 'mode',
        label: '',
        items: modes.map((mode) => ({
          id: mode.id,
          label: translateDefaultField(t, 'modes', mode.id, 'label', mode.label),
          icon: getModeIcon(mode.icon),
          data: { mode },
        })),
      },
    ],
    [modes, t],
  )

  const renderTrigger = (selected: SearchableMenuItem<ModeItemData> | undefined, isOpen: boolean) => (
    <div
      className={cn(
        'flex items-center rounded-lg cursor-pointer transition-colors text-[length:var(--font-size-sm)] border border-border',
        iconOnly ? 'size-[var(--touch-height-control)] justify-center' : 'gap-1.5 px-2 h-[var(--touch-height-control)]',
        isOpen ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      {selected?.icon ?? <MessageCircle className="size-[var(--icon-size-default)] text-muted-foreground" />}
      {!iconOnly && <span className="font-medium text-muted-foreground">{selected?.label ?? chatFallback}</span>}
    </div>
  )

  const renderItem = (item: SearchableMenuItem<ModeItemData>, isSelected: boolean) => {
    const isDefault = item.data?.mode.isDefault === 1

    return (
      <div
        className={cn(
          'w-full flex items-center gap-2 px-3 py-3 md:py-2 rounded-lg transition-colors text-left cursor-pointer',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
      >
        {item.icon}
        <span>{item.label}</span>
        {isDefault && <span className="text-muted-foreground text-[length:var(--font-size-sm)]">Default</span>}
      </div>
    )
  }

  return (
    <SearchableMenu
      items={groupedItems}
      value={selectedMode?.id}
      onValueChange={onModeChange}
      searchable={false}
      blurBackdrop
      side={isMobile ? 'top' : 'bottom'}
      align="start"
      trigger={renderTrigger}
      renderItem={renderItem}
      width={280}
      maxHeight={300}
    />
  )
}
