/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useIsMobile } from '@/hooks/use-mobile'
import type { CitationSource } from '@/types/citation'
import { memo, useState } from 'react'
import { CitationSourcesDrawer } from './citation-sources-drawer'
import { useCitationPopover } from './citation-popover'
import { SourceList } from './source-list'
import { isLocalDocumentCitation, type LocalDocumentCitationSource } from '@/fork/zeroclaw/delivered-citations'
import { useShowSideview } from '@/content-view/context'
import { buildDocumentSideviewId } from '@/types/citation'

type CitationBadgeProps = {
  sources: CitationSource[]
  citationId?: number
}

/**
 * When inside a CitationPopoverProvider, acts as a lightweight trigger (overlay rendered externally).
 * When standalone (block-level widget), owns its own popover/drawer.
 * Memoized to prevent unnecessary re-renders during streaming.
 */
export const CitationBadge = memo(({ sources, citationId }: CitationBadgeProps) => {
  const ctx = useCitationPopover()

  if (!sources || sources.length === 0) {
    return null
  }

  // Fork: one local document behind a `[N]` has nothing to choose between. The popover
  // exists because a citation can stand for SEVERAL sources; with one it adds a click
  // and a 420px panel that, next to an open sideview, Radix has to throw somewhere else
  // on screen. For a web source the card still earns its place — it shows where the
  // click is about to take you — so this covers local documents only.
  if (sources.length === 1 && isLocalDocumentCitation(sources[0])) {
    return <LocalDocumentBadge source={sources[0]} />
  }

  if (ctx && citationId !== undefined) {
    return <ManagedBadge sources={sources} citationId={citationId} />
  }

  return <StandaloneBadge sources={sources} />
})

CitationBadge.displayName = 'CitationBadge'

const badgeClass =
  'inline-flex max-w-48 items-center gap-1 px-2 pt-0.5 pb-1 text-xs font-normal rounded-full bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1'

const getBadgeLabel = (sources: CitationSource[]) => {
  const primary = sources.find((s) => s.isPrimary) || sources[0]
  return {
    displayName: primary.siteName || primary.title,
    additionalCount: sources.length > 1 ? `+${sources.length - 1}` : null,
    ariaLabel:
      sources.length === 1
        ? `View source: ${primary.siteName || primary.title}`
        : `View ${sources.length} sources: ${primary.siteName || primary.title} and ${sources.length - 1} more`,
  }
}

type BadgeButtonProps = {
  sources: CitationSource[]
  isOpen: boolean
  onToggle: (element: HTMLElement) => void
}

const BadgeButton = ({ sources, isOpen, onToggle }: BadgeButtonProps) => {
  const { displayName, additionalCount, ariaLabel } = getBadgeLabel(sources)
  return (
    <button
      onClick={(e) => onToggle(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle(e.currentTarget)
        }
      }}
      className={badgeClass}
      aria-label={ariaLabel}
      aria-expanded={isOpen}
      aria-haspopup="dialog"
      type="button"
    >
      <span className="truncate">{displayName}</span>
      {additionalCount && <span className="shrink-0">{additionalCount}</span>}
    </button>
  )
}

/** Fork: a single local document — the badge IS the action, no list in between. */
const LocalDocumentBadge = memo(({ source }: { source: LocalDocumentCitationSource }) => {
  const showSideview = useShowSideview()
  return (
    <BadgeButton
      sources={[source]}
      isOpen={false}
      onToggle={() => showSideview?.('local-file', buildDocumentSideviewId(source.documentMeta))}
    />
  )
})

LocalDocumentBadge.displayName = 'LocalDocumentBadge'

// --- Context-managed variant (inline in streaming markdown) ---

const ManagedBadge = memo(({ sources, citationId }: { sources: CitationSource[]; citationId: number }) => {
  const ctx = useCitationPopover()!
  const isOpen = ctx.popover?.citationId === citationId

  const toggle = (element: HTMLElement) => {
    if (isOpen) {
      ctx.close()
    } else {
      ctx.open(citationId, sources, element)
    }
  }

  return <BadgeButton sources={sources} isOpen={isOpen} onToggle={toggle} />
})

ManagedBadge.displayName = 'ManagedBadge'

// --- Standalone variant (block-level widget, no streaming concerns) ---

const StandaloneBadge = memo(({ sources }: { sources: CitationSource[] }) => {
  const [isOpen, setIsOpen] = useState(false)
  const { isMobile } = useIsMobile()
  const close = () => setIsOpen(false)
  const badge = <BadgeButton sources={sources} isOpen={isOpen} onToggle={() => setIsOpen(!isOpen)} />

  if (!isMobile) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>{badge}</PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="w-[420px] overflow-hidden rounded-xl p-0">
          <SourceList sources={sources} onSelect={close} />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      {badge}
      <CitationSourcesDrawer open={isOpen} onOpenChange={setIsOpen} sources={sources} />
    </>
  )
})

StandaloneBadge.displayName = 'StandaloneBadge'
