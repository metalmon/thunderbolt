/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt live-test). See ./FORK.md — do not upstream. */

import { describe, expect, test } from 'vitest'
import { type DocumentCitationSource } from '@/types/citation'
import { buildDeliveredCitationPlaceholders, normalizeDeliverCitationFootnotes } from './delivered-citations'
import { type DeliveredFileRef } from './outbound-resource-blob'
import { buildDocumentSideviewId, isDocumentCitation } from '@/types/citation'

const deliveredFiles: DeliveredFileRef[] = [
  {
    localFileId: 'L1',
    filename: 'a.pdf',
    mimeType: 'application/pdf',
    size: 10,
    uri: 'attachment://deliver/a.pdf',
    title: 'Договор аренды',
  },
  {
    localFileId: 'L2',
    filename: '9efe7606154733ab.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 20,
    uri: 'attachment://deliver/9efe7606154733ab.docx',
    title: 'ГОСТ Р 57978-2017',
  },
]

describe('buildDeliveredCitationPlaceholders', () => {
  test('replaces [1] (1-based delivery order) with cite placeholder bound to the local file', () => {
    const { fullText, citations } = buildDeliveredCitationPlaceholders('See [1].', deliveredFiles, 0)
    expect(fullText).toMatch(/\{\{CITE:\d+\}\}/)
    expect(fullText).not.toContain('[1]')
    const sources = citations.get(0)
    expect(sources).toHaveLength(1)
    const s = sources![0]
    expect(isDocumentCitation(s)).toBe(true)
    if (isDocumentCitation(s)) {
      expect(s.documentMeta.fileId).toBe('L1')
      expect(s.documentMeta.fileName).toBe('a.pdf')
      expect(s.id).toBe(buildDocumentSideviewId({ fileId: 'L1', fileName: 'a.pdf' }))
      // Citation label is the Volt title (prose), distinct from the basename id.
      expect(s.title).toBe('Договор аренды')
      expect((s as { localFileSideview?: boolean }).localFileSideview).toBe(true)
    }
  })

  test('title falls back to the basename when the delivered ref carries no title', () => {
    const untitled: DeliveredFileRef[] = [{ ...deliveredFiles[0], title: undefined }]
    const { citations } = buildDeliveredCitationPlaceholders('See [1].', untitled, 0)
    expect((citations.get(0)?.[0] as DocumentCitationSource | undefined)?.title).toBe('a.pdf')
  })

  test('unknown [N] left unchanged', () => {
    const { fullText } = buildDeliveredCitationPlaceholders('See [9].', deliveredFiles, 0)
    expect(fullText).toBe('See [9].')
  })

  test('strips markdown footnote [N]:attachment:// so no raw :uri remains', () => {
    const raw = '**ГОСТ Р 57978-2017**, чанк 1\n\n[2]:attachment://deliver/9efe7606154733ab.docx'
    expect(normalizeDeliverCitationFootnotes(raw)).toBe('**ГОСТ Р 57978-2017**, чанк 1\n\n[2]')
    const { fullText, citations } = buildDeliveredCitationPlaceholders(raw, deliveredFiles, 0)
    expect(fullText).toMatch(/\{\{CITE:\d+\}\}/)
    expect(fullText).not.toContain('attachment://')
    expect(fullText).not.toContain(':attachment')
    expect(citations.size).toBe(1)
    expect((citations.get(0)?.[0] as DocumentCitationSource | undefined)?.documentMeta.fileId).toBe('L2')
  })

  test('allows optional space after colon in footnote form', () => {
    const { fullText } = buildDeliveredCitationPlaceholders('[1]: attachment://deliver/a.pdf', deliveredFiles, 0)
    expect(fullText).toMatch(/^\{\{CITE:\d+\}\}$/)
    expect(fullText).not.toContain('attachment://')
  })

  test('bare attachment://deliver uri becomes cite when among delivered files', () => {
    const { fullText, citations } = buildDeliveredCitationPlaceholders(
      'File:\nattachment://deliver/a.pdf',
      deliveredFiles,
      0,
    )
    expect(fullText).toMatch(/\{\{CITE:\d+\}\}/)
    expect(fullText).not.toContain('attachment://')
    expect((citations.get(0)?.[0] as DocumentCitationSource | undefined)?.documentMeta.fileId).toBe('L1')
  })

  test('markdown link to deliver uri becomes cite when among delivered files', () => {
    const { fullText } = buildDeliveredCitationPlaceholders(
      'See [DOCX](attachment://deliver/9efe7606154733ab.docx).',
      deliveredFiles,
      0,
    )
    expect(fullText).toMatch(/See \{\{CITE:\d+\}\}\./)
    expect(fullText).not.toContain('attachment://')
  })

  test('unknown bare uri left unchanged (no delivered file for it)', () => {
    const { fullText } = buildDeliveredCitationPlaceholders('attachment://deliver/nope.pdf', deliveredFiles, 0)
    expect(fullText).toBe('attachment://deliver/nope.pdf')
  })
})

describe('what counts as a citation', () => {
  // The resolver here and the one in text-part.tsx must agree, so this pins the rule
  // for both: a bracketed number glued to a word is part of that word.
  const oneFile = [
    { localFileId: 'lf1', filename: 'a.pdf', mimeType: 'application/pdf', size: 1, uri: 'attachment://deliver/a.pdf' },
  ]

  test('a bracketed number inside a filename is not a citation', () => {
    const { fullText, citations } = buildDeliveredCitationPlaceholders('see report[1].pdf for detail', oneFile)

    expect(fullText).toBe('see report[1].pdf for detail')
    expect(citations.size).toBe(0)
  })

  test('a version number does not either', () => {
    const { citations } = buildDeliveredCitationPlaceholders('build v1.2[1] shipped', oneFile)

    expect(citations.size).toBe(0)
  })

  test('but a citation right after the sentence period does — the commonest form', () => {
    const { fullText, citations } = buildDeliveredCitationPlaceholders('It is ready.[1]', oneFile)

    expect(citations.size).toBe(1)
    expect(fullText).toContain('{{CITE:')
  })

  test('and so does one after a space, or inside brackets', () => {
    expect(buildDeliveredCitationPlaceholders('ready [1]', oneFile).citations.size).toBe(1)
    expect(buildDeliveredCitationPlaceholders('(see above [1])', oneFile).citations.size).toBe(1)
  })
})
