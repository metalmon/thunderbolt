/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { forwardRef, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

export type TelemetryWarningModalRef = {
  open: () => void
  close: () => void
}

type TelemetryWarningModalProps = {
  onDisableTelemetry: () => Promise<void>
}

export const TelemetryWarningModal = forwardRef<TelemetryWarningModalRef, TelemetryWarningModalProps>(
  ({ onDisableTelemetry }, ref) => {
    const { t } = useTranslation('common')
    const [open, setOpen] = useState(false)

    const handleClose = () => {
      setOpen(false)
    }

    const handleDisableTelemetry = async () => {
      await onDisableTelemetry()
      handleClose()
    }

    useImperativeHandle(ref, () => ({
      open: () => setOpen(true),
      close: handleClose,
    }))

    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('telemetryWarning.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('telemetryWarning.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleClose}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableTelemetry}>{t('telemetryWarning.disable')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  },
)

TelemetryWarningModal.displayName = 'TelemetryWarningModal'
