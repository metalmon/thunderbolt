/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppLogo } from '@/components/app-logo'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

export const NotFound = () => {
  const navigate = useNavigate()
  const { t } = useTranslation('common')

  return (
    <div className="flex flex-col items-center justify-center w-full h-dvh">
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AppLogo size={16} />
          <span>{t('appName')}</span>
        </div>

        <h1 className="text-4xl font-semibold tracking-tight">{t('notFound.title')}</h1>

        <Button variant="secondary" onClick={() => navigate('/chats/new', { replace: true })}>
          {t('notFound.backToApp')}
        </Button>
      </div>
    </div>
  )
}

export default NotFound
