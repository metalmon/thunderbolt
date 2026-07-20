/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { buildDocumentSideviewId } from '@/types/citation'
import { getDeliveredUriRefByUri } from './delivered-uri-ref-map'

export type DocumentResultTarget =
  | {
      kind: 'local-file'
      sideviewType: 'local-file'
      sideviewId: string
      displayName: string
    }
  | {
      kind: 'haystack-document'
      sideviewType: 'document'
      sideviewId: string
      displayName: string
    }
  | { kind: 'missing' }

const isAttachmentDeliverUri = (fileId: string): boolean => fileId.startsWith('attachment://deliver/')

/**
 * Resolve `<widget:document-result fileId=…>` for ZC vs Haystack.
 * Unknown `attachment://deliver/…` must NOT become a Haystack fetch.
 */
export const resolveDocumentResultTarget = (args: { fileId: string; name?: string }): DocumentResultTarget => {
  const fileId = args.fileId.trim()
  if (isAttachmentDeliverUri(fileId)) {
    const ref = getDeliveredUriRefByUri(fileId)
    if (!ref) {
      return { kind: 'missing' }
    }
    // Widget label = explicit name, else ZeroClaw title (prose), else basename. The
    // sideviewId stays keyed on the basename so it matches the download card + citations
    // (all three open the same preview).
    const displayName = (args.name && args.name.trim()) || ref.title || ref.storageBasename
    return {
      kind: 'local-file',
      sideviewType: 'local-file',
      sideviewId: buildDocumentSideviewId({ fileId: ref.localFileId, fileName: ref.storageBasename }),
      displayName,
    }
  }

  const displayName = (args.name && args.name.trim()) || fileId
  return {
    kind: 'haystack-document',
    sideviewType: 'document',
    sideviewId: buildDocumentSideviewId({ fileId, fileName: displayName }),
    displayName,
  }
}
