/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Download, RefreshCw, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { m, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useDesktopUpdate, type UpdateStatus } from '@/hooks/use-desktop-update'
import { Button } from '@/components/ui/button'
import { isDesktop } from '@/lib/platform'

const statusIcons: Record<UpdateStatus, typeof Download> = {
  initial: CheckCircle,
  idle: CheckCircle,
  checking: Loader2,
  available: Download,
  downloading: Loader2,
  ready: RefreshCw,
  error: AlertCircle,
}

export const UpdateNotification = () => {
  const { t } = useTranslation('common')
  const { status, update, error, downloadAndInstall, restartApp, checkForUpdates } = useDesktopUpdate()
  const [dismissed, setDismissed] = useState(false)

  // Only show on desktop platforms
  if (!isDesktop()) {
    return null
  }

  const statusMessages: Record<UpdateStatus, string> = {
    initial: '',
    idle: '',
    checking: t('updateNotification.checking'),
    available: t('updateNotification.available'),
    downloading: t('updateNotification.downloading'),
    ready: t('updateNotification.ready'),
    error: t('updateNotification.error'),
  }

  const showActions = status === 'available' || status === 'ready' || status === 'error'
  const isVisible = !dismissed && status !== 'initial' && status !== 'idle' && status !== 'checking'
  const Icon = statusIcons[status]
  const message = statusMessages[status]

  const handlePrimaryAction = async () => {
    if (status === 'available') {
      await downloadAndInstall()
    } else if (status === 'ready') {
      await restartApp()
    } else if (status === 'error') {
      await checkForUpdates()
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <m.div
          key="update-notification"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-4 right-4 z-50 max-w-sm"
        >
          <div className="bg-card border border-border rounded-lg shadow-lg p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0">
                <Icon
                  className={`size-5 ${status === 'downloading' ? 'animate-spin' : ''} ${
                    status === 'error' ? 'text-destructive' : 'text-primary'
                  }`}
                />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{message}</p>

                {status === 'available' && update && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('updateNotification.version', { version: update.version })}
                  </p>
                )}

                {status === 'error' && error && <p className="text-xs text-destructive mt-1">{error}</p>}

                {showActions && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={handlePrimaryAction}>
                      {status === 'available' && t('updateNotification.download')}
                      {status === 'ready' && t('updateNotification.restartNow')}
                      {status === 'error' && t('updateNotification.retry')}
                    </Button>

                    {status !== 'error' && (
                      <Button size="sm" variant="ghost" onClick={handleDismiss}>
                        {t('updateNotification.later')}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleDismiss}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label={t('updateNotification.dismiss')}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
