/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { buildDocumentSideviewId } from '@/types/citation'
import { deliveredLocalFileId, filenameFromUri } from './outbound-resource-blob'

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
 *
 * ZC deliver uris resolve purely from the uri: the blob was stored under
 * {@link deliveredLocalFileId}(uri) and the basename is parsed from the uri, so a
 * widget clicked after a reload / in a later turn opens the same preview the download
 * card and `[N]` citations open — with no in-memory map. Unknown `attachment://deliver/…`
 * must NOT become a Haystack fetch, hence the dedicated branch.
 */
export const resolveDocumentResultTarget = (args: { fileId: string; name?: string }): DocumentResultTarget => {
  const fileId = args.fileId.trim()
  if (isAttachmentDeliverUri(fileId)) {
    const basename = filenameFromUri(fileId)
    const localFileId = deliveredLocalFileId(fileId)
    // Widget label = explicit name, else the basename. The sideviewId stays keyed on the
    // basename so it matches the download card + citations (all three open the same preview).
    const displayName = (args.name && args.name.trim()) || basename
    return {
      kind: 'local-file',
      sideviewType: 'local-file',
      sideviewId: buildDocumentSideviewId({ fileId: localFileId, fileName: basename }),
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
