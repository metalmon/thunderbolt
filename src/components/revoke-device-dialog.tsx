/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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
import { useTranslation } from 'react-i18next'

type RevokeDeviceDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isPending: boolean
  variant: 'trusted' | 'pending'
}

export const RevokeDeviceDialog = ({ open, onOpenChange, onConfirm, isPending, variant }: RevokeDeviceDialogProps) => {
  const { t } = useTranslation('common')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {variant === 'pending' ? t('revokeDevice.denyTitle') : t('revokeDevice.revokeTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {variant === 'pending' ? t('revokeDevice.pendingDescription') : t('revokeDevice.trustedDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isPending}>
            {isPending
              ? variant === 'pending'
                ? t('revokeDevice.denying')
                : t('revokeDevice.revoking')
              : variant === 'pending'
                ? t('revokeDevice.deny')
                : t('revokeDevice.revoke')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
