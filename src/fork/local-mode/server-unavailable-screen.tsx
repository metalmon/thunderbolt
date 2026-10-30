/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans } from '@lingui/react/macro'
import { AppWordmark } from '@/components/app-wordmark'
import { Button } from '@/components/ui/button'
import { useAppName } from '@/lib/branding-selectors'
import { useLocalSettingsStore } from '@/stores/local-settings-store'
import { enterLocalMode } from './switch-mode'

type ServerUnavailableScreenProps = {
  /** Try the sign-in again. The gate owns the attempt; this only triggers it. */
  onRetry: () => void
}

/**
 * Shown when the app cannot reach its backend at all, so no sign-in can succeed.
 *
 * Deliberately NOT `AppErrorScreen`: that screen offers "clear the local
 * database", which is actively harmful advice here — the server being down is no
 * reason to destroy the user's own data. Modeled on `StorageUnavailableScreen`
 * instead: name the one cause, show what was tried, offer the one action.
 *
 * The address is shown because it is the single most useful fact when this
 * screen appears in a self-hosted deployment — it is almost always either the
 * wrong address or a server that is genuinely down, and the user (or whoever
 * installed this for them) can tell which at a glance.
 */
export const ServerUnavailableScreen = ({ onRetry }: ServerUnavailableScreenProps) => {
  const appName = useAppName()
  const cloudUrl = useLocalSettingsStore((s) => s.cloudUrl)

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-8 text-center">
        <AppWordmark />

        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">
            <Trans>Can't reach the server</Trans>
          </h1>
          <p className="text-muted-foreground">
            <Trans>
              {appName} could not connect to its server, so it can't sign you in. Check that the server is running and
              that you are on the right network.
            </Trans>
          </p>
          {/* Not a <code> block: it is an address, and breaking it across lines
              is better than a horizontal scrollbar on a narrow window. */}
          <p className="mt-2 break-all font-mono text-[length:var(--font-size-sm)] text-muted-foreground">{cloudUrl}</p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button variant="secondary" onClick={onRetry}>
            <Trans>Try again</Trans>
          </Button>

          {/* ⚠ The ONLY way into autonomous operation from a cold start.
              Everything else that switches modes lives in Settings, which is on
              the other side of this gate — so without this button an install
              pointed at a server that is gone cannot be used at all, and the
              screen that says so is also the screen that traps the user. */}
          <Button variant="ghost" onClick={() => void enterLocalMode()}>
            <Trans>Continue without a server</Trans>
          </Button>
          <p className="max-w-sm text-[length:var(--font-size-xs)] text-muted-foreground">
            <Trans>
              {appName} will run on this device only: your own models and keys, no account, nothing synced. You can
              connect a server later in Settings.
            </Trans>
          </p>
        </div>
      </div>
    </div>
  )
}
