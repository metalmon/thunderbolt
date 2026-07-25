/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DetailDivider, DetailPanel, DetailSectionTitle } from '@/components/detail-panel'
import { DetailActionsMenu, DetailEditDeleteMenuItems } from '@/components/settings/detail-actions-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translateDefaultField } from '@/i18n/translate-default'

/**
 * Detail panel for a single skill. Pinning is managed from the chat composer
 * and enable/disable lives on the list row's switch; this view shows the
 * skill's content plus edit/delete controls when the skill is editable.
 */
export const SkillDetail = ({
  id,
  name,
  description,
  instruction,
  readOnly,
  onEdit,
  onDelete,
  onClose,
}: {
  /** Skill id — used to translate built-in skills' name/description at render. */
  id: string
  /** Display name (the human label). */
  name: string
  description: string
  instruction: string
  readOnly: boolean
  onEdit: () => void
  onDelete: () => void
  /** Close (X) — dismisses the desktop slide-in panel or the mobile overlay. */
  onClose: () => void
}) => {
  const { t } = useTranslation('settings')
  const { t: translateDefault } = useTranslation('defaults')
  const displayName = translateDefaultField(translateDefault, 'skills', id, 'name', name)
  const displayDescription = translateDefaultField(translateDefault, 'skills', id, 'description', description)
  const actionsMenu = !readOnly && (
    <DetailActionsMenu>
      <DetailEditDeleteMenuItems onEdit={onEdit} onDelete={onDelete} />
    </DetailActionsMenu>
  )

  return (
    <DetailPanel
      title={displayName}
      subtitle={readOnly ? 'Built-in skill · Read-only' : undefined}
      actions={actionsMenu}
      onClose={onClose}
    >
      <div className="flex shrink-0 flex-col gap-2">
        <DetailSectionTitle>
          {t('skills.description')}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="img"
                aria-label={t('skills.descriptionHelpAria')}
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
              >
                <Info size={13} strokeWidth={1.75} />
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('skills.descriptionHelp')}</TooltipContent>
          </Tooltip>
        </DetailSectionTitle>
        <p className="whitespace-pre-wrap text-base leading-snug text-foreground">{displayDescription}</p>
      </div>

      <DetailDivider />

      <div className="flex flex-col gap-2">
        <DetailSectionTitle>{t('skills.instructions')}</DetailSectionTitle>
        <div className="whitespace-pre-wrap pb-1 text-base leading-snug text-foreground">{instruction}</div>
      </div>
    </DetailPanel>
  )
}
