/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ConfirmActionDialog } from '@/components/ui/confirm-action-dialog'
import { useTranslation } from 'react-i18next'

/**
 * Dirty-form discard prompt for the skill create/edit flows. Thin wrapper
 * over ConfirmActionDialog so it inherits the responsive mobile bottom
 * sheet / desktop alert dialog treatment.
 */
export const DiscardCreateDialog = ({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  title?: string
  description?: string
}) => {
  const { t } = useTranslation('settings')

  return (
    <ConfirmActionDialog
      open={open}
      title={title ?? t('skills.leaveWithoutCreatingTitle')}
      description={description ?? t('skills.unsavedCreateDescription')}
      confirmLabel={t('skills.discard')}
      cancelLabel={t('skills.keepEditing')}
      onConfirm={onConfirm}
      onCancel={() => onOpenChange(false)}
    />
  )
}
