/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { beforeEach, describe, expect, test } from 'vitest'
import { type DocumentCitationSource } from '@/types/citation'
import { clearDeliveredUriRefMap, upsertDeliveredUriRef } from './delivered-uri-ref-map'
import {
  buildDeliveredCitationPlaceholders,
  normalizeDeliverCitationFootnotes,
} from './delivered-citations'
import { buildDocumentSideviewId, isDocumentCitation } from '@/types/citation'

describe('buildDeliveredCitationPlaceholders', () => {
  beforeEach(() => {
    clearDeliveredUriRefMap()
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/a.pdf',
      localFileId: 'L1',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'a.pdf',
    })
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/9efe7606154733ab.docx',
      localFileId: 'L2',
      turnPosition: 2,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      storageBasename: '9efe7606154733ab.docx',
    })
  })

  test('replaces [1] with cite placeholder bound to local file', () => {
    const { fullText, citations } = buildDeliveredCitationPlaceholders('See [1].', 0)
    expect(fullText).toMatch(/\{\{CITE:\d+\}\}/)
    expect(fullText).not.toContain('[1]')
    const sources = citations.get(0)
    expect(sources).toHaveLength(1)
    const s = sources![0]
    expect(isDocumentCitation(s)).toBe(true)
    if (isDocumentCitation(s)) {
      expect(s.documentMeta.fileId).toBe('L1')
      expect(s.id).toBe(buildDocumentSideviewId({ fileId: 'L1', fileName: 'a.pdf' }))
      expect((s as { localFileSideview?: boolean }).localFileSideview).toBe(true)
    }
  })

  test('unknown [N] left unchanged', () => {
    const { fullText } = buildDeliveredCitationPlaceholders('See [9].', 0)
    expect(fullText).toBe('See [9].')
  })

  test('strips markdown footnote [N]:attachment:// so no raw :uri remains', () => {
    const raw =
      '**ГОСТ Р 57978-2017**, чанк 1\n\n[2]:attachment://deliver/9efe7606154733ab.docx'
    expect(normalizeDeliverCitationFootnotes(raw)).toBe(
      '**ГОСТ Р 57978-2017**, чанк 1\n\n[2]',
    )
    const { fullText, citations } = buildDeliveredCitationPlaceholders(raw, 0)
    expect(fullText).toMatch(/\{\{CITE:\d+\}\}/)
    expect(fullText).not.toContain('attachment://')
    expect(fullText).not.toContain(':attachment')
    expect(citations.size).toBe(1)
    expect((citations.get(0)?.[0] as DocumentCitationSource | undefined)?.documentMeta.fileId).toBe('L2')
  })

  test('allows optional space after colon in footnote form', () => {
    const { fullText } = buildDeliveredCitationPlaceholders(
      '[1]: attachment://deliver/a.pdf',
      0,
    )
    expect(fullText).toMatch(/^\{\{CITE:\d+\}\}$/)
    expect(fullText).not.toContain('attachment://')
  })

  test('bare attachment://deliver uri becomes cite when mapped', () => {
    const { fullText, citations } = buildDeliveredCitationPlaceholders(
      'File:\nattachment://deliver/a.pdf',
      0,
    )
    expect(fullText).toMatch(/\{\{CITE:\d+\}\}/)
    expect(fullText).not.toContain('attachment://')
    expect((citations.get(0)?.[0] as DocumentCitationSource | undefined)?.documentMeta.fileId).toBe('L1')
  })

  test('markdown link to deliver uri becomes cite when mapped', () => {
    const { fullText } = buildDeliveredCitationPlaceholders(
      'See [DOCX](attachment://deliver/9efe7606154733ab.docx).',
      0,
    )
    expect(fullText).toMatch(/See \{\{CITE:\d+\}\}\./)
    expect(fullText).not.toContain('attachment://')
  })
})
