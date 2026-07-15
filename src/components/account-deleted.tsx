/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppLogo } from '@/components/app-logo'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

export const AccountDeleted = () => {
  const { t } = useTranslation(['auth', 'common'])

  return (
    <div className="flex flex-col items-center justify-center w-full h-dvh">
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AppLogo size={16} />
          <span>{t('appName', { ns: 'common' })}</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">{t('accountDeleted.title')}</h1>
          <p className="text-muted-foreground">{t('accountDeleted.description')}</p>
        </div>

        <Button variant="secondary" onClick={() => window.location.replace('/')}>
          {t('accountDeleted.backToApp')}
        </Button>
      </div>
    </div>
  )
}
