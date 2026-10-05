/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Trans } from '@lingui/react/macro'
import { Cpu } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'

/**
 * What the chat pane shows when the installation has no model yet.
 *
 * The fork ships an empty catalog — a closed perimeter cannot reach the cloud model
 * upstream seeds — so a fresh install genuinely has nothing to chat with until the
 * operator points it at his own endpoint. Before this, that state rendered as a black
 * pane with a working sidebar and an unhandled `No system model found` in the console.
 */
export const NoModelConfigured = () => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
    <Cpu className="size-[var(--icon-size-default)] text-muted-foreground" aria-hidden />
    <div className="flex flex-col gap-2">
      <h2 className="text-[length:var(--font-size-body)] font-medium">
        <Trans>No model is set up yet</Trans>
      </h2>
      <p className="max-w-prose text-[length:var(--font-size-sm)] text-muted-foreground">
        <Trans>
          Add the address of your own model server in Settings — this installation ships without one on purpose, so
          nothing reaches outside your network.
        </Trans>
      </p>
    </div>
    <Button asChild>
      <Link to="/settings/models">
        <Trans>Open model settings</Trans>
      </Link>
    </Button>
  </div>
)
