/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useContentView } from '@/content-view/context'
import type { ThunderboltUIMessage } from '@/types'
import { uiResourceArtifactId } from './ui-resource'
import { isUiResourcePart, uiResourceOfPart } from './ui-resource-part'

export type ChipState = 'ready' | 'open' | 'updated' | 'superseded'

export type CanvasEntry = {
  artifactId: string
  latestToolCallId: string
  dismissed: boolean
  dismissedAtToolCallId: string | null
}

type LatestRef = { artifactId: string; latestToolCallId: string }

/** Scan messages in order; the LAST `ui://` part per uri is the live anchor (§5 rehydrate). */
export const computeLatestByUri = (messages: ThunderboltUIMessage[]): Map<string, LatestRef> => {
  const map = new Map<string, LatestRef>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isUiResourcePart(part)) {
        continue
      }
      const ref = uiResourceOfPart(part)
      if (!ref) {
        continue
      }
      map.set(ref.uri, { artifactId: uiResourceArtifactId(ref.uri), latestToolCallId: part.toolCallId })
    }
  }
  return map
}

/** Pure chip-state (§UX): superseded unless latest; then open / updated / ready. */
export const deriveChipState = (args: {
  entry: CanvasEntry | undefined
  toolCallId: string
  openArtifactId: string | null
}): ChipState => {
  const { entry, toolCallId, openArtifactId } = args
  if (!entry || entry.latestToolCallId !== toolCallId) {
    return 'superseded'
  }
  if (openArtifactId === entry.artifactId) {
    return 'open'
  }
  if (entry.dismissed && entry.dismissedAtToolCallId !== entry.latestToolCallId) {
    return 'updated'
  }
  return 'ready'
}

/** A genuine panel close is artifact → null; switching to sideview/preview/object-view is NOT a close (§UX). */
export const isGenuineClose = (prevArtifactId: string | null, stateType: string | null): boolean =>
  prevArtifactId !== null && stateType === null

type RegistryValue = {
  getEntry: (uri: string) => CanvasEntry | undefined
  hasAutoOpened: (uri: string) => boolean
  markAutoOpened: (uri: string) => void
  clearDismissed: (uri: string) => void
}

const CanvasRegistryContext = createContext<RegistryValue | undefined>(undefined)

export const CanvasRegistryProvider = ({
  messages,
  children,
}: {
  messages: ThunderboltUIMessage[]
  children: ReactNode
}) => {
  const { state } = useContentView()
  const latestByUri = useMemo(() => computeLatestByUri(messages), [messages])
  // uri → toolCallId that was latest at close time; presence means dismissed.
  const [dismissedByUri, setDismissedByUri] = useState<Map<string, string>>(() => new Map())
  const autoOpened = useRef<Set<string>>(new Set())

  const openArtifactId = state.type === 'artifact' ? state.data.artifactId : null

  // Close-watch: artifact → null (user closed the panel) dismisses that uri (§5, finding D).
  const prevArtifactId = useRef<string | null>(null)
  useEffect(() => {
    const closed = isGenuineClose(prevArtifactId.current, state.type)
    if (closed) {
      for (const [uri, ref] of latestByUri) {
        if (ref.artifactId === prevArtifactId.current) {
          setDismissedByUri((prev) => new Map(prev).set(uri, ref.latestToolCallId))
          break
        }
      }
    }
    prevArtifactId.current = openArtifactId
  }, [openArtifactId, state.type, latestByUri])

  const getEntry = useCallback(
    (uri: string): CanvasEntry | undefined => {
      const ref = latestByUri.get(uri)
      if (!ref) {
        return undefined
      }
      const dismissedAt = dismissedByUri.get(uri) ?? null
      return { ...ref, dismissed: dismissedAt !== null, dismissedAtToolCallId: dismissedAt }
    },
    [latestByUri, dismissedByUri],
  )

  const value = useMemo<RegistryValue>(
    () => ({
      getEntry,
      hasAutoOpened: (uri) => autoOpened.current.has(uri),
      markAutoOpened: (uri) => autoOpened.current.add(uri),
      clearDismissed: (uri) =>
        setDismissedByUri((prev) => {
          if (!prev.has(uri)) {
            return prev
          }
          const next = new Map(prev)
          next.delete(uri)
          return next
        }),
    }),
    [getEntry],
  )

  return <CanvasRegistryContext.Provider value={value}>{children}</CanvasRegistryContext.Provider>
}

export const useCanvasRegistry = (): RegistryValue => {
  const ctx = useContext(CanvasRegistryContext)
  if (ctx === undefined) {
    throw new Error('useCanvasRegistry must be used within a CanvasRegistryProvider')
  }
  return ctx
}
