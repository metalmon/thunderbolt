/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, test } from 'vitest'
import { resolveDocumentResultTarget } from './resolve-delivered-file'
import { deliveredLocalFileId } from './outbound-resource-blob'
import { buildDocumentSideviewId } from '@/types/citation'

describe('resolveDocumentResultTarget', () => {
  const uri = 'attachment://deliver/a1b2c3d4e5f6.pdf'
  const localFileId = deliveredLocalFileId(uri)

  test('deliver uri resolves with no map — purely from the uri (survives reload)', () => {
    const target = resolveDocumentResultTarget({ fileId: uri, name: 'Договор.pdf' })
    expect(target).toEqual({
      kind: 'local-file',
      sideviewType: 'local-file',
      // sideviewId keyed on the basename + the deterministic uri-derived id (the same id
      // the blob was stored under), NOT the label — so card/citation/widget all agree.
      sideviewId: buildDocumentSideviewId({ fileId: localFileId, fileName: 'a1b2c3d4e5f6.pdf' }),
      displayName: 'Договор.pdf',
    })
  })

  test('deterministic id has no colon/slash so it is a safe sideviewId first segment', () => {
    expect(localFileId).toMatch(/^zc-[0-9a-f]{8}$/)
    expect(localFileId).not.toContain(':')
    expect(localFileId).not.toContain('/')
  })

  test('missing name falls back to the basename', () => {
    const target = resolveDocumentResultTarget({ fileId: uri })
    if (target.kind !== 'local-file') throw new Error('expected a resolved local-file target')
    expect(target.displayName).toBe('a1b2c3d4e5f6.pdf')
    expect(target.sideviewId).toContain('a1b2c3d4e5f6.pdf')
    expect(target.sideviewId).toContain(localFileId)
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
