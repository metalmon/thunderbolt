/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ImperativeConfirmActionDialog, type ConfirmActionDialogRef } from '@/components/ui/confirm-action-dialog'

export type DeleteChatDialogRef = ConfirmActionDialogRef

type DeleteChatDialogProps = {
  isPending?: boolean
  onCancel?: () => void
  onConfirm: () => void
}

export const DeleteChatDialog = forwardRef<DeleteChatDialogRef, DeleteChatDialogProps>((props, ref) => {
  const { t } = useTranslation(['chat', 'common'])

  return (
    <ImperativeConfirmActionDialog
      ref={ref}
      title={t('deleteChat.title')}
      description={t('deleteChat.description')}
      confirmLabel={t('deleteChat.confirm')}
      {...props}
    />
  )
})

DeleteChatDialog.displayName = 'DeleteChatDialog'
