/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { arch } from '@tauri-apps/plugin-os'
import { AlertTriangle, Check, Download, ExternalLink, Loader2, Terminal } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyCommandRow } from '@/components/settings/copy-command-row'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type CliInstallArchitecture,
  type CliInstallPlatform,
  type CliInstallResult,
  canInstallThunderboltCli,
  describeCliInstallError,
  installThunderboltCli,
} from '@/lib/cli-install'
import { getPlatform, isTauri } from '@/lib/platform'

/** Shell one-liner to build the CLI from source when no prebuilt binary applies. */
const manualBuildCommand = 'cd cli && bun install && bun run build && ./install.sh'
const cliInstallGuideUrl = 'https://github.com/thunderbird/thunderbolt/blob/main/cli/README.md#install'

type InstallState =
  | { status: 'idle' }
  | { status: 'success'; result: CliInstallResult }
  | { status: 'error'; message: string; showManualBuild: boolean }

type ThunderboltCliInstallCardProps = {
  /** Injectable installer (production omits; tests supply a fake). */
  install?: () => Promise<CliInstallResult>
  /** Test seam for the runtime platform; production reads `getPlatform()`. */
  platform?: CliInstallPlatform
  /** Test seam for the runtime CPU architecture; production reads Tauri's OS plugin. */
  architecture?: CliInstallArchitecture
  /** Test seam for the Tauri check; production reads `isTauri()`. */
  tauri?: boolean
}

/**
 * One-click install of the standalone `thunderbolt` CLI on supported macOS/Linux
 * builds. Invokes the Rust command that downloads, checksum-verifies and installs
 * the prebuilt binary into `~/.local/bin`, then renders the installed path (with
 * a PATH hint if the dir isn't on `PATH`) or a clear error. When a release has no
 * CLI assets, it surfaces the manual build fallback instead of failing silently.
 * Web builds link to the install guide; Tauri builds render nothing on unpublished
 * OS/architecture pairs.
 */
export const ThunderboltCliInstallCard = ({
  install = installThunderboltCli,
  platform,
  architecture,
  tauri,
}: ThunderboltCliInstallCardProps) => {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<InstallState>({ status: 'idle' })
  const [isPending, startTransition] = useTransition()

  const isTauriEnv = tauri ?? isTauri()
  const runtimeArchitecture = architecture ?? (isTauriEnv ? arch() : 'unknown')

  if (isTauriEnv && !canInstallThunderboltCli(platform ?? getPlatform(), runtimeArchitecture, isTauriEnv)) {
    return null
  }

  const handleInstall = () => {
    startTransition(async () => {
      try {
        const result = await install()
        setState({ status: 'success', result })
      } catch (error) {
        const { message, showManualBuild } = describeCliInstallError(error)
        setState({ status: 'error', message, showManualBuild })
      }
    })
  }

  return (
    <Card className="border border-border">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Terminal className="size-8 text-muted-foreground shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1 min-w-0">
            <CardTitle>{t('agents.cliTitle')}</CardTitle>
            <CardDescription>
              {isTauriEnv ? t('agents.cliDescriptionTauri') : t('agents.cliDescriptionWeb')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isTauriEnv ? (
          <>
            <Button variant="secondary" className="self-start" disabled={isPending} onClick={handleInstall}>
              {isPending ? <Loader2 className="animate-spin" /> : <Download />}
              {isPending ? t('agents.installing') : t('agents.installCli')}
            </Button>

            {state.status === 'success' && (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2 text-[length:var(--font-size-sm)]">
                  <Check className="size-4 shrink-0 text-green-600" aria-hidden="true" />
                  {t('agents.installedTo', { path: state.result.path })}
                </p>
                {!state.result.onPath && state.result.pathHint && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[length:var(--font-size-xs)] text-muted-foreground">{t('agents.addPath')}</p>
                    <CopyCommandRow command={state.result.pathHint} label={t('agents.copyPathCommand')} />
                  </div>
                )}
              </div>
            )}

            {state.status === 'error' && (
              <div className="flex flex-col gap-3">
                <p className="flex items-start gap-2 text-[length:var(--font-size-sm)] text-destructive">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
                  {state.message}
                </p>
                {state.showManualBuild && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[length:var(--font-size-xs)] text-muted-foreground">
                      {t('agents.buildFromSource')}
                    </p>
                    <CopyCommandRow command={manualBuildCommand} label={t('agents.copyBuildCommand')} />
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <Button asChild variant="secondary" className="self-start">
            <a href={cliInstallGuideUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              {t('agents.viewInstallGuide')}
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
