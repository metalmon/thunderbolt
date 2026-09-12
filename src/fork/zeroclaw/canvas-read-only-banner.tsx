/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { Trans } from '@lingui/react/macro'
import { Lock } from 'lucide-react'

/**
 * Read-only snapshot banner (Task 9, level 2 "should"): shown on the
 * artifact-panel chrome when the open `ui://` canvas was emitted by an agent
 * that is no longer the thread's selected agent. Styled like
 * `ArtifactErrorStrip` so both banners read as one family.
 */
export const CanvasReadOnlyBanner = ({ emittingAgentName }: { emittingAgentName: string | null }) => (
  <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-1.5 text-xs text-muted-foreground">
    <Lock className="size-3.5 shrink-0" />
    <span className="truncate">
      {emittingAgentName ? (
        <Trans>Read-only snapshot from {emittingAgentName} — switch back to interact</Trans>
      ) : (
        <Trans>Read-only snapshot — switch back to the original agent to interact</Trans>
      )}
    </span>
  </div>
)
