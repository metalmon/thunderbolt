/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans, useLingui } from '@lingui/react/macro'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionCard } from '@/components/ui/section-card'
import { clearLocalData } from '@/lib/cleanup'
import { useLocalSettingsStore } from '@/stores/local-settings-store'
import { useIsLocalMode } from './mode'
import { isServerEditAllowed, verifyServerAddress } from './server-address'
import { dropServerCredentials, enterLocalMode, enterServerMode } from './switch-mode'

/** What the pending confirmation is about. */
type Pending = { kind: 'to-local' } | { kind: 'to-server'; url: string; host: string } | null

/**
 * The one place a backend address is entered and the one place the operating
 * mode is chosen.
 *
 * Industry practice puts the server address on the sign-in screen (Element,
 * Nextcloud, Mattermost's first run) and has the failure screen point at it.
 * This is that single editor; the "can't reach the server" screen links here.
 *
 * Hidden entirely unless the build allows it (`isServerEditAllowed`), because a
 * field like this is reachable by persuasion rather than by code — "paste this
 * address and it will work" sends the bearer token wherever the address points.
 * An OEM delivery has its address as a deployment fact and gets no field.
 *
 * Leaving local mode does NOT enable sync, and the dialog says so: writes made
 * while autonomous sit in the upload queue carrying no user id, so the server
 * would file this device's history under whoever signs in first. The user picks
 * what happens to that data BEFORE signing in — that choice cannot be made
 * afterwards, because by then the account has already claimed it.
 */
export const ServerSection = () => {
  const { t } = useLingui()
  const localMode = useIsLocalMode()
  const cloudUrl = useLocalSettingsStore((s) => s.cloudUrl)
  const setLocalSetting = useLocalSettingsStore((s) => s.setLocalSetting)
  const [draft, setDraft] = useState(cloudUrl)
  const [pending, setPending] = useState<Pending>(null)

  if (!isServerEditAllowed()) {
    return null
  }

  const verdict = verifyServerAddress(draft)
  const currentVerdict = verifyServerAddress(cloudUrl)
  const currentHost = currentVerdict.ok ? currentVerdict.host : null
  const addressError = () => {
    if (verdict.ok || verdict.reason === 'empty') {
      return null
    }
    return verdict.reason === 'unparseable'
      ? t`Enter a full address, including https:// and the /v1 path.`
      : t`Only https is allowed, or http for an address on this machine.`
  }

  const confirmToServer = () => {
    if (!verdict.ok) {
      return
    }
    setPending({ kind: 'to-server', url: verdict.url, host: verdict.host })
  }

  const applyServer = async (wipeLocal: boolean) => {
    if (pending?.kind !== 'to-server') {
      return
    }
    // Retargeting one backend to another: a token and session issued by the old
    // server must never be presented to the new one, and the old deployment's
    // config must not describe the new one. Local mode has none of these to
    // begin with, so this is the server-to-server path specifically.
    if (!localMode && pending.host !== currentHost) {
      await dropServerCredentials()
    }
    setLocalSetting('cloudUrl', pending.url)
    if (wipeLocal) {
      // Before the mode flips, so nothing has started reading this install as a
      // server one while the old data is still here.
      await clearLocalData({ clearAuth: false })
    }
    enterServerMode()
    setPending(null)
  }

  return (
    <SectionCard title={t`Server`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {localMode ? (
            <Trans>
              This installation works on this device only. Connect a server to sign in and sync across devices.
            </Trans>
          ) : (
            <Trans>The address this installation signs in to and syncs with.</Trans>
          )}
        </p>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="fork-server-address">
            <Trans>Server address</Trans>
          </label>
          <Input
            id="fork-server-address"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={addressError() !== null}
          />
          {addressError() && <p className="text-sm text-destructive">{addressError()}</p>}
        </div>

        {/* Right-aligned: these are the card's actions on the field above it,
            and a form's commit belongs at the end of its row, not under the
            label as if it were another field. */}
        <div className="flex flex-wrap justify-end gap-2">
          {localMode ? (
            <Button onClick={confirmToServer} disabled={!verdict.ok}>
              <Trans>Connect this server</Trans>
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={confirmToServer} disabled={!verdict.ok || draft.trim() === cloudUrl}>
                <Trans>Save address</Trans>
              </Button>
              <Button variant="outline" onClick={() => setPending({ kind: 'to-local' })}>
                <Trans>Work on this device only</Trans>
              </Button>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          {pending?.kind === 'to-local' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <Trans>Work on this device only?</Trans>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <Trans>
                    Sync stops and you will be signed out. Everything already on this device stays, and the features
                    that need the server — the account, sync, web search and the server's models — will be hidden.
                  </Trans>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Trans>Cancel</Trans>
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void enterLocalMode()
                    setPending(null)
                  }}
                >
                  <Trans>Work offline</Trans>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <Trans>Connect this server?</Trans>
                </AlertDialogTitle>
                {/* The host on its own line: this dialog exists so the user reads
                    back where their credentials are about to go. */}
                <p className="break-all font-mono text-[length:var(--font-size-sm)]">
                  {pending?.kind === 'to-server' ? pending.host : ''}
                </p>
                <AlertDialogDescription>
                  {localMode ? (
                    <Trans>
                      Sync stays off until you sign in and choose what happens to this device's data. Chats created here
                      have no owner yet, so whichever account signs in first would claim them.
                    </Trans>
                  ) : (
                    <Trans>
                      You will be signed out and sync will stop: the credentials you hold were issued by the current
                      server and must not be sent to a different one.
                    </Trans>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Trans>Cancel</Trans>
                </AlertDialogCancel>
                <Button variant="destructive" onClick={() => void applyServer(true)}>
                  <Trans>Connect and start clean</Trans>
                </Button>
                <AlertDialogAction onClick={() => void applyServer(false)}>
                  <Trans>Connect and keep local data</Trans>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  )
}
