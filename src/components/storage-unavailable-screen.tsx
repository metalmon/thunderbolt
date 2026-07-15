/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppLogo } from '@/components/app-logo'
import { Button } from '@/components/ui/button'
import { isIosPlatform } from '@/lib/platform'
import { useTranslation } from 'react-i18next'

export const StorageUnavailableScreen = () => {
  const { t } = useTranslation('common')
  const lockdownHint = isIosPlatform()
  return (
    <div className="flex flex-col items-center justify-center w-full h-dvh p-4">
      <div className="flex flex-col items-center gap-8 text-center max-w-md">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AppLogo size={16} />
          <span>{t('appName')}</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">{t('storageUnavailable.title')}</h1>
          <p className="text-muted-foreground">
            {t('storageUnavailable.description')}{' '}
            {lockdownHint ? t('storageUnavailable.lockdownHint') : t('storageUnavailable.genericHint')}
          </p>
        </div>

        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t('reload')}
        </Button>
      </div>
    </div>
  )
}
