/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt). Do not upstream. */

import { useEffect, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { Check, Loader2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmActionDialog } from '@/components/ui/confirm-action-dialog'
import { addCliDirToPath, cliPathTarget, type CliPathUpdate } from '@/lib/cli-install'

type AddToPathButtonProps = {
  /** The directory the CLI was installed into, named in the confirmation. */
  directory: string
  /** Test seams; production calls the Tauri commands. */
  addToPath?: typeof addCliDirToPath
  readTarget?: typeof cliPathTarget
}

type State =
  | { status: 'idle' | 'pending' }
  | { status: 'done'; result: CliPathUpdate }
  | { status: 'error'; message: string }

/**
 * Offers to put the CLI's directory on the user's persistent `PATH`.
 *
 * ⚠ Behind an explicit confirmation, always, and the confirmation NAMES THE
 * TARGET. The change lands outside the app and outlives it — the Windows user
 * environment, or a shell startup file the user maintains by hand — so "we'll
 * edit your PATH" is not enough to agree to.
 *
 * The target is read from the backend rather than guessed here: only the
 * running process knows which shell `$SHELL` names, and offering to edit
 * `~/.bashrc` to someone running fish would be worse than offering nothing.
 */
export const AddToPathButton = ({
  directory,
  addToPath = addCliDirToPath,
  readTarget = cliPathTarget,
}: AddToPathButtonProps) => {
  const { t } = useLingui()
  const [confirming, setConfirming] = useState(false)
  const [target, setTarget] = useState('')
  const [state, setState] = useState<State>({ status: 'idle' })

  // External system read with no render-time answer: the target depends on the
  // host's environment, not on props or state.
  useEffect(() => {
    let cancelled = false
    readTarget()
      .then((value) => {
        if (!cancelled) setTarget(value)
      })
      // A missing description must not hide the button; the directory below is
      // named either way, and the backend refuses what it cannot do.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [readTarget])

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
        description={
          target
            ? t`${directory} will be added to ${target}. The change is permanent and affects every terminal you open from now on.`
            : t`${directory} will be added to your PATH. The change is permanent and affects every terminal you open from now on.`
        }
        confirmLabel={t`Add to PATH`}
        confirmVariant="default"
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
