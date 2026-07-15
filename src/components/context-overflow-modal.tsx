/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { formatNumber } from '@/lib/utils'
import { AlertTriangle } from 'lucide-react'
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
} from './ui/alert-dialog'

type ContextOverflowModalProps = {
  isOpen: boolean
  onClose: () => void
  onNewChat: () => void
  maxTokens?: number
}

/**
 * Modal shown when a message would exceed the model's context window
 */
export const ContextOverflowModal = ({ isOpen, onClose, onNewChat, maxTokens }: ContextOverflowModalProps) => {
  const { t } = useTranslation('common')
  const formattedMaxTokens = maxTokens ? formatNumber(maxTokens) : 'unknown'

  return (
    <AlertDialog open={isOpen} onOpenChange={() => onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-600" />
            <AlertDialogTitle>{t('contextOverflow.title')}</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            <p>{t('contextOverflow.description', { maxTokens: formattedMaxTokens })}</p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{t('close')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onNewChat()
              onClose()
            }}
          >
            {t('contextOverflow.newChat')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
