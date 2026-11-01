/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt). Do not upstream. */

import { getAttachments } from '@/lib/attachments'
import { buildDocumentSideviewId, type DocumentCitationSource } from '@/types/citation'
import type { ThunderboltUIMessage } from '@/types'
import type { SourceMetadata } from '@/types/source'

/**
 * Files the user attached, as entries in the turn's source registry.
 *
 * A document the user attached is a source the reply draws claims from, exactly as a
 * search result is — but it arrives as content of the user's message rather than as a
 * tool result, so nothing registered it and a `[1]` the model wrote against it resolved
 * to nothing. See docs/development/attachment-citations.md.
 *
 * ⚠ The numbering is the registry's, not a second one of our own. The Pro tools start
 * their counter at `sourceCollector.length + 1`, so seeding the collector with these
 * before the toolset is built hands attachments 1…k and leaves search continuing at
 * k+1 — with no change to the tools and no chance of a collision to check for.
 *
 * Only the latest user turn is registered: earlier turns were numbered when they ran,
 * and their citations resolve from their own message's persisted sources.
 */
export const attachmentSourcesOfTurn = (messages: readonly ThunderboltUIMessage[]): SourceMetadata[] => {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  if (!lastUserMessage) {
    return []
  }
  return getAttachments(lastUserMessage).map((attachment, position) => ({
    index: position + 1,
    // Attachments have no address; the citation opens the local preview instead, which
    // is what `localFileId` is carried for.
    url: '',
    title: attachment.filename,
    siteName: attachment.filename.split('.').pop()?.toUpperCase() ?? '',
    localFileId: attachment.localFileId,
    toolName: 'attachment' as const,
  }))
}

/** Whether this registry entry is an attached file rather than a web result. */
export const isAttachmentSource = (source: SourceMetadata): boolean => source.toolName === 'attachment'

/**
 * The citation an attachment entry renders as: a document, so clicking it opens the
 * preview the file chip already opens, rather than trying to navigate an empty URL.
 *
 * ⚠ No `pageNumber`. The file is delivered whole — nothing anywhere splits it into
 * pages — so a page number would have to be invented, and it would be shown.
 */
export const attachmentCitation = (source: SourceMetadata, isPrimary: boolean): DocumentCitationSource => {
  const fileId = source.localFileId ?? ''
  return {
    id: buildDocumentSideviewId({ fileId, fileName: source.title }),
    title: source.title,
    url: '',
    siteName: source.siteName,
    isPrimary,
    documentMeta: { fileId, fileName: source.title },
  }
}

/**
 * The line that tells the model an attachment's number.
 *
 * ⚠ It is a part of its own rather than a prefix on the extracted text, because the
 * two delivery paths that are NOT plain text — raw bytes and rasterized pages — carry
 * no text at all. `defaultDeliveryMode` sends docx and PDF as bytes, so a number that
 * lived in the text prefix would be missing for exactly the documents people cite.
 */
export const attachmentMarker = (filename: string, index: number): string => `[Attachment ${index}: ${filename}]`
