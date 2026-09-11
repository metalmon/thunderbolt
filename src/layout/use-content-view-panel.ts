/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { openTargetWidth } from '@/content-view/panel-width'
import { animate } from 'framer-motion'
import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
import type { Layout, PanelImperativeHandle } from 'react-resizable-panels'

export const contentViewPanelId = 'content-view'

type ContentViewPanelOptions = {
  isOpen: boolean
  panelRef: RefObject<Pick<PanelImperativeHandle, 'getSize' | 'resize'> | null>
  savedWidth: number | null
  saveWidth: (width: number) => Promise<void>
  /** Fork: `useContentView().state.type`. A `ui://` artifact is a mini-app and opens
   *  wider than a document, so the target width is per view type — and a chip-clicked
   *  artifact replacing an open document must re-animate to the new type's width. */
  viewType: string | null
  /** Fork: the persisted `artifact_view_width`; `savedWidth` stays the document one. */
  artifactWidth: number | null
}

/** Animate panel visibility while persisting only settled user layout changes. */
export const useContentViewPanel = ({
  isOpen,
  panelRef,
  savedWidth,
  saveWidth,
  viewType,
  artifactWidth,
}: ContentViewPanelOptions) => {
  // Fork: seeded to `false`, not the current open state. The chat layout unmounts when
  // navigating to Settings and remounts on return, while the content-view state (held
  // above the router) stays open. Seeding to the current state made the size effect see
  // "no change" on remount, so the panel rendered at its 0% defaultSize and had to be
  // dragged back open. Seeding false makes a remount-with-open run the open path and
  // size the panel to the saved width.
  const previousOpen = useRef(false)
  const previousType = useRef(viewType)
  const isAnimating = useRef(false)
  const lastSettledWidth = useRef(savedWidth)
  const pendingWidth = useRef<{ width: number } | null>(null)

  const startTransition = useEffectEvent(() => {
    const openChanged = previousOpen.current !== isOpen
    // Fork: a chip-clicked artifact replacing an open document (or the reverse) keeps the
    // panel open, so only the type changes — it still has to re-animate to the new width.
    const typeChangedWhileOpen = isOpen && !openChanged && previousType.current !== viewType
    previousOpen.current = isOpen
    previousType.current = viewType
    if (!openChanged && !typeChangedWhileOpen) {
      return
    }
    const panel = panelRef.current
    if (!panel) {
      return
    }

    // A quick close/reopen can beat the settings query's refresh after a resize.
    const preferredWidth = pendingWidth.current?.width ?? savedWidth
    const openWidth = openTargetWidth(
      viewType,
      viewType === 'artifact' ? (pendingWidth.current?.width ?? artifactWidth) : artifactWidth,
      preferredWidth,
      window.innerWidth,
    )
    const targetWidth = isOpen ? openWidth : 0
    isAnimating.current = true
    const animation = { current: null as ReturnType<typeof animate> | null }
    const frame = requestAnimationFrame(() => {
      animation.current = animate(panel.getSize().asPercentage, targetWidth, {
        duration: 0.3,
        ease: [0.32, 0.72, 0, 1],
        onUpdate: (width) => panel.resize(`${width}%`),
        onComplete: () => {
          isAnimating.current = false
          if (targetWidth > 0) {
            lastSettledWidth.current = panel.getSize().asPercentage
          }
        },
      })
    })

    return () => {
      cancelAnimationFrame(frame)
      animation.current?.stop()
      isAnimating.current = false
    }
  })

  useEffect(() => startTransition(), [isOpen, viewType])

  /** Release the temporary preference when a save settles, without clearing a newer resize. */
  const persistWidth = async (width: number) => {
    const pending = { width }
    pendingWidth.current = pending
    try {
      await saveWidth(width)
    } finally {
      if (pendingWidth.current === pending) {
        pendingWidth.current = null
      }
    }
  }

  // Group calls this once on pointer release and for each keyboard resize.
  // Its imperative resize callbacks also arrive here during our animation.
  const handleLayoutChanged = (layout: Layout) => {
    const width = layout[contentViewPanelId]
    if (!isOpen || previousOpen.current !== isOpen || isAnimating.current || !width) {
      return
    }
    if (lastSettledWidth.current === width) {
      return
    }
    lastSettledWidth.current = width
    return persistWidth(width)
  }

  return { handleLayoutChanged }
}
