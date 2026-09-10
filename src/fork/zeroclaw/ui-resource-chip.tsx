/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { useEffect } from 'react'
import { AppWindow } from 'lucide-react'
import { Trans } from '@lingui/react/macro'
import { Button } from '@/components/ui/button'
import { useContentView } from '@/content-view/context'
import type { ToolOrDynamicToolUIPart } from '@/lib/assistant-message'
import { deriveArtifactTitle } from './ui-resource'
import { uiResourceOfPart } from './ui-resource-part'
import { deriveChipState, useCanvasRegistry } from './canvas-registry'

/**
 * Transcript anchor for a ZeroClaw `ui://` artifact (§UX). Side-panel-first: the
 * chip is the only inline surface (no live inline card). It gates auto-open to a
 * free slot, updates the open panel in place, and re-opens on click.
 */
export const UiResourceChip = ({ part }: { part: ToolOrDynamicToolUIPart }) => {
  const ref = uiResourceOfPart(part)
  const { state, showArtifact, close } = useContentView()
  const { getEntry, hasAutoOpened, markAutoOpened, clearDismissed } = useCanvasRegistry()

  const uri = ref?.uri ?? ''
  const html = ref?.html ?? ''
  const title = ref ? deriveArtifactTitle(html, uri) : ''
  const entry = getEntry(uri)
  // The registry is the single source of truth for artifact identity (salted by threadId).
  const artifactId = entry?.artifactId ?? ''
  const openArtifactId = state.type === 'artifact' ? state.data.artifactId : null
  const isLatest = entry?.latestToolCallId === part.toolCallId
  const chipState = deriveChipState({ entry, toolCallId: part.toolCallId, openArtifactId })

  const open = () => {
    clearDismissed(uri)
    showArtifact({ html, title, artifactId })
  }

  // First-emit auto-open (only into a free slot; once per uri) + update-in-place while open.
  useEffect(() => {
    if (!ref || !entry || !isLatest) {
      return
    }
    if (state.type === 'artifact' && state.data.artifactId === artifactId && state.data.html !== html) {
      showArtifact({ html, title, artifactId })
      return
    }
    if (!hasAutoOpened(uri) && !entry?.dismissed) {
      markAutoOpened(uri)
      if (state.type === null) {
        showArtifact({ html, title, artifactId })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, isLatest, html, artifactId, uri, state.type, state.type === 'artifact' ? state.data.artifactId : null])

  if (!ref || !entry) {
    return null
  }

  if (chipState === 'superseded') {
    return (
      <div className="my-2 text-xs text-muted-foreground/70">
        <Trans>{title} — superseded, updated below</Trans>
      </div>
    )
  }

  return (
    <div className="my-2 flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-3 py-2">
      <AppWindow className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {chipState === 'open' ? (
          <Trans>{title} — shown in side panel</Trans>
        ) : chipState === 'updated' ? (
          <Trans>{title} — updated</Trans>
        ) : (
          <span>{title}</span>
        )}
      </span>
      {chipState === 'open' ? (
        <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={close}>
          <Trans>Close</Trans>
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={open}>
          <Trans>Open</Trans>
        </Button>
      )}
    </div>
  )
}
