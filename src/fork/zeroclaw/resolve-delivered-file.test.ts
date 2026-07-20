/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { beforeEach, describe, expect, test } from 'vitest'
import { clearDeliveredUriRefMap, upsertDeliveredUriRef } from './delivered-uri-ref-map'
import { resolveDocumentResultTarget } from './resolve-delivered-file'
import { buildDocumentSideviewId } from '@/types/citation'

describe('resolveDocumentResultTarget', () => {
  beforeEach(() => {
    clearDeliveredUriRefMap()
  })

  test('attachment://deliver uri → local-file sideview', () => {
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      localFileId: 'local-abc',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'a1b2c3d4e5f6.pdf',
    })
    const target = resolveDocumentResultTarget({
      fileId: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      name: 'Договор.pdf',
    })
    expect(target).toEqual({
      kind: 'local-file',
      sideviewType: 'local-file',
      sideviewId: buildDocumentSideviewId({ fileId: 'local-abc', fileName: 'Договор.pdf' }),
      displayName: 'Договор.pdf',
    })
  })

  test('missing name falls back to storage basename', () => {
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      localFileId: 'local-abc',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'a1b2c3d4e5f6.pdf',
    })
    const target = resolveDocumentResultTarget({
      fileId: 'attachment://deliver/a1b2c3d4e5f6.pdf',
    })
    if (target.kind === 'missing') throw new Error('expected a resolved target for a mapped deliver uri')
    expect(target.displayName).toBe('a1b2c3d4e5f6.pdf')
    expect(target.sideviewId).toContain('a1b2c3d4e5f6.pdf')
  })

  test('unknown attachment uri on ZC path → missing (not haystack)', () => {
    const target = resolveDocumentResultTarget({
      fileId: 'attachment://deliver/nope.pdf',
      name: 'x.pdf',
    })
    expect(target).toEqual({ kind: 'missing' })
  })

  test('non-attachment fileId → haystack-document (unchanged path)', () => {
    const target = resolveDocumentResultTarget({ fileId: 'deepset-uuid-1', name: 'a.pdf' })
    expect(target).toEqual({
      kind: 'haystack-document',
      sideviewType: 'document',
      sideviewId: buildDocumentSideviewId({ fileId: 'deepset-uuid-1', fileName: 'a.pdf' }),
      displayName: 'a.pdf',
    })
  })
})
