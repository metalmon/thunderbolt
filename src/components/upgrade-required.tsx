/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useTranslation } from 'react-i18next'

import { AppLogo } from '@/components/app-logo'
import { Button } from '@/components/ui/button'
import { useDesktopUpdate, type UpdateStatus } from '@/hooks/use-desktop-update'
import { isDesktop } from '@/lib/platform'

type UpgradeRequiredProps = {
  currentVersion: string
  minVersion: string
}

/** Desktop button label key per update status — mirrors the primary action of the
 *  `UpdateNotification` popover, extended to the states the popover hides. */
const desktopActionLabelKey: Record<UpdateStatus, string> = {
  initial: 'upgradeRequired.checkForUpdates',
  idle: 'upgradeRequired.checkForUpdates',
  checking: 'upgradeRequired.checking',
  available: 'upgradeRequired.downloadUpdate',
  downloading: 'upgradeRequired.downloading',
  ready: 'upgradeRequired.restartToUpdate',
  error: 'upgradeRequired.retry',
}

/**
 * The recovery action on the hard-block screen. On the web the only escape is a
 * reload (which re-fetches `/config`); on desktop we drive the same Tauri updater
 * flow as the `UpdateNotification` popover — check → download → restart.
 */
const UpgradeAction = () => {
  const { t } = useTranslation('common')
  const { status, primaryAction } = useDesktopUpdate()

  if (!isDesktop()) {
    return (
      <Button variant="secondary" onClick={() => window.location.reload()}>
        {t('upgradeRequired.reload')}
      </Button>
    )
  }

  const busy = status === 'checking' || status === 'downloading'

  return (
    <Button variant="secondary" onClick={primaryAction} disabled={busy}>
      {t(desktopActionLabelKey[status])}
    </Button>
  )
}

export const UpgradeRequired = ({ currentVersion, minVersion }: UpgradeRequiredProps) => {
  const { t } = useTranslation('common')

  return (
    <div className="flex flex-col items-center justify-center w-full h-dvh">
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-1.5 text-[length:var(--font-size-sm)] text-muted-foreground">
          <AppLogo size={16} />
          <span>{t('appName')}</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">{t('upgradeRequired.title')}</h1>
          <p className="text-muted-foreground max-w-md">{t('upgradeRequired.description')}</p>
          <p className="text-[length:var(--font-size-sm)] text-muted-foreground">
            {t('upgradeRequired.versions', { currentVersion, minVersion })}
          </p>
        </div>

        <UpgradeAction />
      </div>
    </div>
  )
}
