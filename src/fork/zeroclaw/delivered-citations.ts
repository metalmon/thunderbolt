/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import {
  buildDocumentSideviewId,
  type CitationMap,
  type CitationSource,
  type DocumentCitationSource,
} from '@/types/citation'
import {
  getDeliveredUriRefByTurnPosition,
  getDeliveredUriRefByUri,
  type DeliveredUriRef,
} from './delivered-uri-ref-map'

const groupedCitationRegex = /\[\d+\](?!\()(?:\s*\[\d+\](?!\())*/g
const individualCitationRegex = /\[(\d+)\]/g

/**
 * Models often emit CommonMark reference-definition form `[N]:attachment://deliver/…`
 * (or `[N]: attachment://…`). Our `[N]` rewriter turns `[N]` into a cite badge and
 * leaves a raw `:attachment://…` suffix — normalize to bare `[N]` first.
 */
const footnoteDeliverUriRegex = /\[(\d+)\]\s*:\s*attachment:\/\/deliver\/[^\s)\]>'"]+/g

/** Bare / markdown-linked deliver URIs the model pasted instead of `[N]` or a widget. */
const bareDeliverUriRegex = /(?:\[([^\]]*)\]\()?(attachment:\/\/deliver\/[^\s)\]>'"]+)\)?/g

/** Document citation that should open sideview `local-file` (ZC path). */
export type LocalDocumentCitationSource = DocumentCitationSource & {
  localFileSideview: true
}

export const isLocalDocumentCitation = (source: CitationSource): source is LocalDocumentCitationSource =>
  (source as Partial<LocalDocumentCitationSource>).localFileSideview === true

const sourceFromRef = (ref: DeliveredUriRef, isPrimary: boolean): LocalDocumentCitationSource => {
  const ext = ref.storageBasename.split('.').pop()?.toLowerCase() ?? ''
  return {
    id: buildDocumentSideviewId({ fileId: ref.localFileId, fileName: ref.storageBasename }),
    // Citation label = ZeroClaw title (prose). The stable sideviewId + documentMeta stay
    // keyed on the basename so the widget/card open the same preview.
    title: ref.title,
    url: '',
    siteName: ext.toUpperCase(),
    isPrimary,
    documentMeta: {
      fileId: ref.localFileId,
      fileName: ref.storageBasename,
    },
    localFileSideview: true,
  }
}

/** Strip `[N]:attachment://deliver/…` → `[N]` so the cite rewriter does not leave `:uri` text. */
export const normalizeDeliverCitationFootnotes = (text: string): string =>
  text.replace(footnoteDeliverUriRegex, '[$1]')

/**
 * Replace known bare / markdown `attachment://deliver/…` with a cite placeholder
 * when the uri is in the turn ref-map. Unknown URIs are left unchanged.
 */
const replaceBareDeliverUris = (
  text: string,
  citations: CitationMap,
  startKey: number,
): { fullText: string; nextKey: number } => {
  let nextKey = startKey
  const fullText = text.replace(bareDeliverUriRegex, (match, _label: string | undefined, uri: string) => {
    // Footnote form already normalized; avoid double-matching leftover fragments.
    if (match.startsWith(':')) {
      return match
    }
    const ref = getDeliveredUriRefByUri(uri)
    if (!ref) {
      return match
    }
    const key = nextKey++
    citations.set(key, [sourceFromRef(ref, true)])
    return `{{CITE:${key}}}`
  })
  return { fullText, nextKey }
}

export const buildDeliveredCitationPlaceholders = (
  text: string,
  startKey = 0,
): { fullText: string; citations: CitationMap } => {
  const citations: CitationMap = new Map()
  let nextKey = startKey

  const normalized = normalizeDeliverCitationFootnotes(text)

  let fullText = normalized.replace(groupedCitationRegex, (match) => {
    const validSources: LocalDocumentCitationSource[] = []
    for (const m of match.matchAll(individualCitationRegex)) {
      const n = parseInt(m[1], 10)
      const ref = getDeliveredUriRefByTurnPosition(n)
      if (!ref) {
        continue
      }
      validSources.push(sourceFromRef(ref, validSources.length === 0))
    }
    if (validSources.length === 0) {
      return match
    }
    const key = nextKey++
    citations.set(key, validSources)
    return `{{CITE:${key}}}`
  })

  ;({ fullText, nextKey } = replaceBareDeliverUris(fullText, citations, nextKey))

  return { fullText, citations }
}
