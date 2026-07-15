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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { HandleError } from '@/types/handle-errors'
import { useTranslation } from 'react-i18next'

/**
 * Generates a support email with error details and stack traces
 */
const generateSupportEmail = (error: HandleError, subject: string, bodyPrefix: string) => {
  let body = bodyPrefix

  if (error.stackTrace) {
    body += `\n\nStack Trace:\n${error.stackTrace}`
  }

  if (error.originalError && error.originalError instanceof Error && error.originalError.stack) {
    body += `\n\nOriginal Error Stack:\n${error.originalError.stack}`
  }

  return {
    subject: encodeURIComponent(subject),
    body: encodeURIComponent(body),
  }
}

type AppErrorScreenProps = {
  error: HandleError
  isClearingDatabase: boolean
  onClearDatabase: () => void
}

export const AppErrorScreen = ({ error, isClearingDatabase, onClearDatabase }: AppErrorScreenProps) => {
  const { t } = useTranslation('common')
  const isDatabaseError = error.code === 'MIGRATION_FAILED' || error.code === 'DATABASE_INIT_FAILED'

  return (
    <div className="flex flex-col items-center justify-center w-full h-[100vh] p-4">
      <div className="text-red-500 text-center mb-4">{t('appError.title')}</div>
      <div className="text-sm text-gray-500 text-center mb-6">{error.message}</div>

      <div className="flex flex-col gap-3">
        {isDatabaseError && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isClearingDatabase}>
                {isClearingDatabase ? t('appError.clearingDatabase') : t('appError.clearDatabase')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('appError.clearDatabaseTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('appError.clearDatabaseDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onClearDatabase}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {t('appError.clearDatabaseConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <Button
          variant="outline"
          onClick={() => {
            const { subject, body } = generateSupportEmail(
              error,
              t('appError.supportEmailSubject'),
              t('appError.supportEmailBody', { code: error.code, message: error.message }),
            )
            window.open(`mailto:support@thunderbird.net?subject=${subject}&body=${body}`)
          }}
        >
          {t('appError.contactSupport')}
        </Button>
      </div>
    </div>
  )
}
