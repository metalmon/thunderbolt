/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { SquarePen, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'

/** Shared right-click Edit/Delete menu for settings list rows. */
export const EditDeleteContextMenuContent = ({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) => {
  const { t } = useTranslation()
  return (
    <ContextMenuContent className="min-w-56">
      <ContextMenuItem onClick={onEdit} className="cursor-pointer">
        <SquarePen className="size-4 mr-2" />
        {t('common:edit')}
      </ContextMenuItem>
      <ContextMenuItem onClick={onDelete} className="cursor-pointer">
        <Trash2 className="size-4 mr-2" />
        {t('chat:permission.delete')}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
