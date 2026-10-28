/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans } from '@lingui/react/macro'
import { HardDrive } from 'lucide-react'
import { useIsLocalMode } from './mode'

/**
 * Says, once and quietly, that this installation keeps everything on this
 * machine.
 *
 * Not decoration: the one thing local mode must never do is degrade silently.
 * Every surface that needs our backend is simply absent in this mode, so
 * without a statement somewhere the user has no way to tell "this build has no
 * sync" from "sync is broken today" — and no way to know their conversations
 * are not leaving the machine, which is the reason most people would choose
 * this mode in the first place.
 *
 * Deliberately not dismissible and deliberately not a toast. A toast is gone
 * before it is read and says nothing about a standing condition; a dismissible
 * banner answers the question once and then stops answering it.
 *
 * Renders nothing in server mode, so the seam that mounts it needs no condition
 * of its own.
 */
export const LocalModeBanner = () => {
  if (!useIsLocalMode()) {
    return null
  }
  return (
    <div
      className="flex items-center justify-center gap-2 border-b bg-muted/60 px-4 py-1.5 text-center text-[length:var(--font-size-xs)] text-muted-foreground"
      // The whole app is below it, so a live region would announce on every
      // navigation. It is a standing label, not a notification.
      role="note"
    >
      <HardDrive className="size-[var(--icon-size-sm)] shrink-0" aria-hidden />
      <span>
        <Trans>Working on this device only — no account, no sync.</Trans>
      </span>
    </div>
  )
}
