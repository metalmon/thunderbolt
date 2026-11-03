/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useIsMobile } from '@/hooks/use-mobile'
import type { CitationSource } from '@/types/citation'
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CitationSourcesDrawer } from './citation-sources-drawer'
import { SourceList } from './source-list'

type PopoverData = {
  citationId: number
  sources: CitationSource[]
  anchorElement: HTMLElement
  /** Fork: where the badge was when it was clicked — see {@link CitationOverlay}. */
  anchorRect: { left: number; top: number; width: number }
}

type CitationPopoverState = {
  popover: PopoverData | null
  open: (id: number, sources: CitationSource[], element: HTMLElement) => void
  close: () => void
}

const CitationPopoverContext = createContext<CitationPopoverState | null>(null)

/** Returns context value if inside a CitationPopoverProvider, or null otherwise. */
export const useCitationPopover = () => useContext(CitationPopoverContext)

/**
 * Provides citation popover state and renders the overlay (popover/drawer)
 * outside the markdown tree so streaming re-renders don't destroy it.
 */
export const CitationPopoverProvider = ({ children }: { children: ReactNode }) => {
  const [popover, setPopover] = useState<PopoverData | null>(null)

  const open = useCallback((id: number, sources: CitationSource[], element: HTMLElement) => {
    // Fork: measured HERE, not in an effect — see {@link CitationOverlay} for why.
    const rect = element.getBoundingClientRect()
    setPopover({
      citationId: id,
      sources,
      anchorElement: element,
      anchorRect: { left: rect.left, top: rect.bottom, width: rect.width },
    })
  }, [])

  const close = useCallback(() => setPopover(null), [])

  const value = useMemo(() => ({ popover, open, close }), [popover, open, close])

  return (
    <CitationPopoverContext.Provider value={value}>
      {children}
      <CitationOverlay popover={popover} close={close} />
    </CitationPopoverContext.Provider>
  )
}

// --- Overlay (rendered automatically by the provider, outside the markdown tree) ---

/**
 * Fork: the anchor is portalled to `document.body` and placed during RENDER, from a
 * rect measured when the badge was clicked. Two separate faults, both measured.
 *
 * **Why the portal.** `src/fork/perf/message-perf.css` puts `content-visibility:
 * auto` on every message to skip the layout of off-screen ones. That implies
 * `contain: layout style paint size`, and paint containment makes the element a
 * containing block for `position: fixed` DESCENDANTS. The anchor sat inside a
 * message, so `left: 496px` resolved against the message box at (480, 146) and the
 * span landed at (976, 505) — measured, not inferred. Radix then placed the card
 * perfectly, under an anchor that was in the wrong place. The earlier
 * `collisionBoundary` fix was treating that symptom. In `document.body` nothing can
 * contain the anchor, and a future containment anywhere in the chat tree cannot
 * bring this back.
 *
 * **Why measure at click.** The position used to be written onto the span from an
 * effect.
 *
 * React paints
 * the span at its default position, Radix measures it THERE, and only then does the
 * effect move it. Floating-ui's `autoUpdate` watches resizes and ancestor scrolling,
 * not an element moved by a later style write, so nothing re-measured. Rendering the
 * position inline removes that window: Radix's first measurement sees the right
 * place. A scroll closes the popover, so the rect cannot go stale while it is open.
 */
const CitationOverlay = memo(({ popover, close }: { popover: PopoverData | null; close: () => void }) => {
  const { isMobile } = useIsMobile()

  useEffect(() => {
    if (!popover) {
      return
    }
    const handler = () => close()
    window.addEventListener('scroll', handler, { capture: true })
    return () => window.removeEventListener('scroll', handler, { capture: true })
  }, [popover, close])

  if (!popover) {
    return null
  }

  const { sources } = popover

  if (isMobile) {
    return <CitationSourcesDrawer open onOpenChange={(open) => !open && close()} sources={sources} />
  }

  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      {createPortal(
        <PopoverAnchor asChild>
          <span
            style={{
              position: 'fixed',
              left: popover.anchorRect.left,
              top: popover.anchorRect.top,
              width: popover.anchorRect.width,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </PopoverAnchor>,
        document.body,
      )}
      {/* Fork: the card belongs to the sentence it was clicked in, so it must stay
          inside the chat column. Radix defaults its collision boundary to the VIEWPORT,
          and a 420px card anchored near the right of a narrow column then fits the
          viewport perfectly well — by covering the sideview next to it. Bounding it to
          the column makes it flip or shift beside the badge instead. */}
      <PopoverContent
        align="start"
        side="bottom"
        collisionBoundary={popover.anchorElement.closest<HTMLElement>('[data-chat-column]')}
        collisionPadding={8}
        className="w-[min(420px,calc(100%-1rem))] overflow-hidden rounded-xl p-0"
      >
        <SourceList sources={sources} onSelect={close} />
      </PopoverContent>
    </Popover>
  )
})

CitationOverlay.displayName = 'CitationOverlay'
