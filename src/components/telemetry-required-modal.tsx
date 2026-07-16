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

export type TelemetryRequiredModalRef = {
  open: (featureName?: string | null) => void
  close: () => void
}

type TelemetryRequiredModalProps = {
  onEnableTelemetry: (featureName?: string | null) => Promise<void>
}

export const TelemetryRequiredModal = forwardRef<TelemetryRequiredModalRef, TelemetryRequiredModalProps>(
  ({ onEnableTelemetry }, ref) => {
    const { t } = useTranslation('common')
    const [open, setOpen] = useState(false)
    const [featureName, setFeatureName] = useState<string | null>(null)

    const handleOpen = (featureName?: string | null) => {
      setFeatureName(featureName || null)
      setOpen(true)
    }

    const handleClose = () => {
      setOpen(false)
      setFeatureName(null)
    }

    const handleEnableTelemetry = async () => {
      await onEnableTelemetry(featureName)
      handleClose()
    }

    useImperativeHandle(ref, () => ({
      open: handleOpen,
      close: handleClose,
    }))

    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('telemetryRequired.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('telemetryRequired.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleClose}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleEnableTelemetry}>{t('telemetryRequired.enable')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  },
)

TelemetryRequiredModal.displayName = 'TelemetryRequiredModal'
