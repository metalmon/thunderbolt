/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ModificationIndicator } from '@/components/modification-indicator'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/components/ui/section-card'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'
import { getCapabilities, isTauri } from '@/lib/platform'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'

export default function DevSettingsPage() {
  const { t } = useTranslation('settings')
  const settings = useLocalSettingsStore(
    useShallow((s) => ({
      cloudUrl: s.cloudUrl,
      isNativeFetchEnabled: s.isNativeFetchEnabled,
      debugPosthog: s.debugPosthog,
    })),
  )
  const { cloudUrl, isNativeFetchEnabled, debugPosthog } = settings
  const setLocalSetting = useLocalSettingsStore((s) => s.setLocalSetting)

  const isModified = <K extends keyof typeof settings>(key: K) => settings[key] !== initialLocalSettings[key]

  const resetSetting = <K extends keyof typeof initialLocalSettings>(key: K) =>
    setLocalSetting(key, initialLocalSettings[key])

  const { data: capabilities } = useQuery({
    queryKey: ['capabilities'],
    queryFn: getCapabilities,
    enabled: isTauri(),
  })

  return (
    <div className="flex flex-col gap-6 p-4 w-full max-w-[760px] mx-auto">
      <PageHeader title={t('developer.title')} />

      <SectionCard title={t('network.title')}>
        <div className="flex flex-col gap-8">
          {/* Cloud URL Setting */}
          <div className="space-y-2">
            <ModificationIndicator
              as="label"
              className="block text-sm font-medium"
              hasModifications={isModified('cloudUrl')}
              onReset={() => resetSetting('cloudUrl')}
            >
              {t('developer.cloudUrlLabel')}
            </ModificationIndicator>
            <Input
              type="url"
              value={cloudUrl}
              onChange={(e) => setLocalSetting('cloudUrl', e.target.value)}
              // Consumers (http client, PowerSync, ACP transports) can't work
              // with a blank base URL, but snapping back mid-edit would make
              // the field impossible to clear and retype — so restore the
              // default only when the field is left empty.
              onBlur={(e) => {
                if (e.target.value.trim() === '') {
                  resetSetting('cloudUrl')
                }
              }}
              placeholder="http://localhost:8000"
            />
            <p className="text-sm text-muted-foreground">{t('developer.cloudUrlDescription')}</p>
          </div>

          {/* Divider between settings */}
          <div className="border-t -mx-6" />

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <ModificationIndicator
                as="label"
                className="text-sm font-medium"
                hasModifications={isModified('isNativeFetchEnabled')}
                onReset={() => resetSetting('isNativeFetchEnabled')}
              >
                {t('developer.nativeFetchLabel')}
              </ModificationIndicator>
              <p className="text-sm text-muted-foreground">{t('developer.nativeFetchDescription')}</p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Switch
                    checked={isNativeFetchEnabled}
                    onCheckedChange={(value) => setLocalSetting('isNativeFetchEnabled', value)}
                    disabled={!capabilities?.native_fetch}
                  />
                </span>
              </TooltipTrigger>
              {!capabilities?.native_fetch && (
                <TooltipContent sideOffset={4}>{t('developer.nativeFetchUnavailableDescription')}</TooltipContent>
              )}
            </Tooltip>
          </div>

          {/* Divider between settings */}
          <div className="border-t -mx-6" />

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <ModificationIndicator
                as="label"
                className="text-sm font-medium"
                hasModifications={isModified('debugPosthog')}
                onReset={() => resetSetting('debugPosthog')}
              >
                {t('developer.debugPostHogLabel')}
              </ModificationIndicator>
              <p className="text-sm text-muted-foreground">{t('developer.debugPostHogDescription')}</p>
            </div>
            <Switch checked={debugPosthog} onCheckedChange={(value) => setLocalSetting('debugPosthog', value)} />
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
