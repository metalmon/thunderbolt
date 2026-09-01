/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type RemoveBridgeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isPending: boolean
}

/** Confirms permanent removal of a revoked bridge device — the one frontend flow
 *  that hard-deletes (a sanctioned device-removal exception to soft-delete). */
export const RemoveBridgeDialog = ({ open, onOpenChange, onConfirm, isPending }: RemoveBridgeDialogProps) => {
  const { t } = useTranslation('settings')
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('removeBridge.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('removeBridge.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('removeBridge.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isPending}>
            {isPending ? t('removeBridge.removing') : t('removeBridge.remove')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
