/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt). Do not upstream. */

import { useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Check, Loader2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmActionDialog } from '@/components/ui/confirm-action-dialog'
import { addCliDirToPath, type CliPathUpdate } from '@/lib/cli-install'

type AddToPathButtonProps = {
  /** The directory the CLI was installed into, named in the confirmation. */
  directory: string
  /** Test seam; production calls the Tauri command. */
  addToPath?: typeof addCliDirToPath
}

/**
 * Offers to put the CLI's directory on the user's persistent `PATH`.
 *
 * ⚠ Behind an explicit confirmation, always. The write lands in
 * `HKCU\Environment` and outlives the app, so it is not something an install
 * button may do on the user's behalf — the dialog names the exact directory and
 * says the change is permanent before anything is written.
 *
 * Windows only. On POSIX the `PATH` is assembled by whichever shell the user
 * runs, from a profile file we must not rewrite behind their back; there the
 * panel keeps showing the one-line hint to paste.
 */
export const AddToPathButton = ({ directory, addToPath = addCliDirToPath }: AddToPathButtonProps) => {
  const { t } = useLingui()
  const [confirming, setConfirming] = useState(false)
  const [state, setState] = useState<
    { status: 'idle' | 'pending' } | { status: 'done'; result: CliPathUpdate } | { status: 'error'; message: string }
  >({ status: 'idle' })

  const confirm = async () => {
    setState({ status: 'pending' })
    setConfirming(false)
    try {
      setState({ status: 'done', result: await addToPath() })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  if (state.status === 'done') {
    return (
      <p className="flex items-center gap-2 text-[length:var(--font-size-sm)]">
        <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
        {state.result.alreadyPresent ? (
          <Trans>Already on your PATH.</Trans>
        ) : (
          <Trans>Added to your PATH. Open a new terminal to use it.</Trans>
        )}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        className="self-start"
        disabled={state.status === 'pending'}
        onClick={() => setConfirming(true)}
      >
        {state.status === 'pending' ? <Loader2 className="animate-spin" /> : <Wrench />}
        <Trans>Add to PATH</Trans>
      </Button>
      {state.status === 'error' && (
        <p className="text-[length:var(--font-size-xs)] text-destructive">{state.message}</p>
      )}
      <ConfirmActionDialog
        open={confirming}
        title={t`Add the CLI to your PATH?`}
        description={t`${directory} will be added to your user PATH. The change is permanent and affects every terminal you open from now on.`}
        confirmLabel={t`Add to PATH`}
        confirmVariant="default"
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
