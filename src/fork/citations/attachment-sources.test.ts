/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { attachmentPartType } from '@/lib/attachments'
import type { ThunderboltUIMessage } from '@/types'
import {
  attachmentCitation,
  attachmentCitationNote,
  attachmentMarker,
  attachmentRefsFromSources,
  attachmentSourcesOfTurn,
  isAttachmentSource,
} from './attachment-sources'

const userMessageWith = (...filenames: string[]): ThunderboltUIMessage =>
  ({
    id: 'u1',
    role: 'user',
    parts: [
      { type: 'text', text: 'what does it say?' },
      ...filenames.map((filename) => ({
        type: attachmentPartType,
        data: { localFileId: `file-${filename}`, filename, mimeType: 'application/octet-stream' },
      })),
    ],
  }) as unknown as ThunderboltUIMessage

const assistantMessage = { id: 'a1', role: 'assistant', parts: [] } as unknown as ThunderboltUIMessage

describe('attachmentSourcesOfTurn', () => {
  it('numbers the latest turn’s attachments from one, in attachment order', () => {
    const sources = attachmentSourcesOfTurn([userMessageWith('report.docx', 'data.xlsx')])

    expect(sources.map((source) => [source.index, source.title])).toEqual([
      [1, 'report.docx'],
      [2, 'data.xlsx'],
    ])
  })

  it('leaves room for the web tools to continue the same numbering', () => {
    // The Pro tools start at `sourceCollector.length + 1`, so seeding decides where
    // search begins. This is the whole reason attachments go into the same registry.
    const sources = attachmentSourcesOfTurn([userMessageWith('report.docx')])

    expect(sources.length + 1).toBe(2)
  })

  it('registers the latest user turn only — earlier turns were numbered when they ran', () => {
    const sources = attachmentSourcesOfTurn([
      userMessageWith('old.docx'),
      assistantMessage,
      userMessageWith('new.docx'),
    ])

    expect(sources.map((source) => source.title)).toEqual(['new.docx'])
  })

  it('is empty when the turn carries no attachment, so the registry is untouched', () => {
    expect(attachmentSourcesOfTurn([userMessageWith()])).toEqual([])
    expect(attachmentSourcesOfTurn([])).toEqual([])
  })

  it('carries the local file id, which is the only way back to the preview', () => {
    const [source] = attachmentSourcesOfTurn([userMessageWith('report.docx')])

    expect(source.localFileId).toBe('file-report.docx')
    expect(source.url).toBe('')
    expect(isAttachmentSource(source)).toBe(true)
  })
})

describe('attachmentCitation', () => {
  it('renders as a document so the badge opens the preview, not an empty URL', () => {
    const [source] = attachmentSourcesOfTurn([userMessageWith('report.docx')])
    const citation = attachmentCitation(source, true)

    expect(citation.documentMeta).toEqual({ fileId: 'file-report.docx', fileName: 'report.docx' })
    expect(citation.url).toBe('')
    expect(citation.siteName).toBe('DOCX')
  })

  it('never invents a page number — the file is delivered whole', () => {
    const [source] = attachmentSourcesOfTurn([userMessageWith('report.docx')])

    expect(attachmentCitation(source, true).documentMeta.pageNumber).toBeUndefined()
  })
})

describe('attachmentMarker', () => {
  it('names the number the model is to cite', () => {
    expect(attachmentMarker('report.docx', 2)).toBe('[Attachment 2: report.docx]')
  })
})

describe('attachmentCitationNote', () => {
  it('names each attachment by the number the reply must cite', () => {
    const sources = attachmentSourcesOfTurn([userMessageWith('report.docx', 'data.xlsx')])
    const note = attachmentCitationNote(sources)

    expect(note).toContain('[1] report.docx')
    expect(note).toContain('[2] data.xlsx')
  })

  it('leaves a turn without attachments untouched, so the prompt cache survives', () => {
    expect(attachmentCitationNote([])).toBeNull()
  })

  it('ignores web sources sharing the registry', () => {
    const webSource = {
      index: 1,
      url: 'https://example.com',
      title: 'Example',
      toolName: 'search' as const,
    }

    expect(attachmentCitationNote([webSource])).toBeNull()
  })
})

describe('attachmentRefsFromSources', () => {
  it('keeps attachment order so [1] lands on the first attachment, not the first delivered file', () => {
    const sources = attachmentSourcesOfTurn([userMessageWith('a.docx', 'b.docx')])

    expect(attachmentRefsFromSources(sources).map((ref) => [ref.filename, ref.localFileId])).toEqual([
      ['a.docx', 'file-a.docx'],
      ['b.docx', 'file-b.docx'],
    ])
  })

  it('drops web sources, which the ACP path resolves by position and would shift', () => {
    const webSource = { index: 1, url: 'https://example.com', title: 'Example', toolName: 'search' as const }

    expect(attachmentRefsFromSources([webSource])).toEqual([])
  })
})
