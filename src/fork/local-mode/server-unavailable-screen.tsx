/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans } from '@lingui/react/macro'
import { AppWordmark } from '@/components/app-wordmark'
import { Button } from '@/components/ui/button'
import { useAppName } from '@/lib/branding-selectors'
import { clearAuthToken } from '@/lib/auth-token'
import { clearCachedSession } from '@/lib/session-cache'
import { setSyncEnabled } from '@/db/powersync/sync-state'
import { useLocalSettingsStore } from '@/stores/local-settings-store'

/** Forget the unreachable server: an empty address is what autonomous means. */
const forgetServer = async () => {
  await setSyncEnabled(false)
  clearAuthToken()
  clearCachedSession()
  useLocalSettingsStore.getState().setLocalSetting('cloudUrl', '')
  window.location.reload()
}

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

          {/* ⚠ The ONLY way out of a server that is gone. Everything upstream
              offers for forgetting one — `disconnectUnclaimedServer`, the
              change-server button — refuses once `serverHasAuthenticated` is
              set, and that latch is never cleared. Without this button an
              install whose server died cannot be used at all, and the screen
              that says so is also the screen that traps the user.

              An empty `cloudUrl` IS autonomous operation (upstream reads it
              that way everywhere), so forgetting the address is the whole
              switch. The credentials go with it: a token and a session issued
              by that server must not outlive it, and sync is read on every
              boot, so an install left with it set would keep trying to
              upload. */}
          <Button variant="ghost" onClick={() => void forgetServer()}>
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
