/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ImperativeConfirmActionDialog, type ConfirmActionDialogRef } from '@/components/ui/confirm-action-dialog'

export type DeleteAllChatsDialogRef = ConfirmActionDialogRef

type DeleteAllChatsDialogProps = {
  isPending?: boolean
  onConfirm: () => void
}

export const DeleteAllChatsDialog = forwardRef<DeleteAllChatsDialogRef, DeleteAllChatsDialogProps>((props, ref) => {
  const { t } = useTranslation(['chat', 'common'])

  return (
    <ImperativeConfirmActionDialog
      ref={ref}
      title={t('deleteAllChats.title')}
      description={t('deleteAllChats.description')}
      confirmLabel={t('deleteAllChats.confirm')}
      {...props}
    />
  )
})

DeleteAllChatsDialog.displayName = 'DeleteAllChatsDialog'
