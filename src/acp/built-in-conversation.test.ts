/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@/testing-library'

import { describe, expect, it } from 'bun:test'
import type { StoredFile } from '@/lib/file-blob-storage'
import type { ThunderboltUIMessage } from '@/types'
import { prepareBuiltInConversation, type BuiltInConversationDeps } from './built-in-conversation'

const storedFile = (id: string, mimeType: string): StoredFile => ({
  id,
  filename: id,
  mimeType,
  size: 1,
  createdAt: 0,
  blob: new Blob([id], { type: mimeType }),
})

const message = (role: 'user' | 'assistant', parts: ThunderboltUIMessage['parts']): ThunderboltUIMessage => ({
  id: crypto.randomUUID(),
  role,
  parts,
})

describe('prepareBuiltInConversation', () => {
  it('flattens quotes/text attachments and maps current images to Pi image content', async () => {
    const files = new Map([
      ['notes', storedFile('notes', 'text/plain')],
      ['diagram', storedFile('diagram', 'image/png')],
    ])
    const deps: BuiltInConversationDeps = {
      getAttachment: async (id) => files.get(id) ?? null,
      getTransformer: async (mimeType, target) =>
        mimeType === 'text/plain' && target === 'text' ? async () => ({ text: 'note contents' }) : null,
      blobToBase64: async () => 'aW1hZ2U=',
    }
    const messages = [
      message('user', [
        { type: 'text', text: 'Review this' },
        {
          type: 'data-attachment',
          data: { localFileId: 'notes', filename: 'notes.txt', mimeType: 'text/plain' },
        },
      ]),
      message('assistant', [{ type: 'text', text: 'Reviewed.' }]),
      message('user', [
        { type: 'data-quote', data: { text: 'first line\nsecond line' } },
        { type: 'text', text: 'What changed?' },
        {
          type: 'data-attachment',
          data: { localFileId: 'diagram', filename: 'diagram.png', mimeType: 'image/png' },
        },
      ]),
    ]

    const prepared = await prepareBuiltInConversation(messages, ['Follow project style.'], deps)

    expect(prepared.history).toEqual([
      { role: 'user', text: 'Review this\n[Attachment: notes.txt]\n\nnote contents' },
      { role: 'assistant', text: 'Reviewed.' },
    ])
    // Fork: the current turn's attachment carries the number the reply cites it as, and
    // the turn ends with the document list. Earlier turns stay unnumbered (see history
    // above). See docs/development/attachment-citations.md.
    expect(prepared.prompt.text).toContain('Follow project style.\n\n> first line\n> second line\nWhat changed?')
    expect(prepared.prompt.text).toContain('[Attachment 1: "diagram.png"]')
    expect(prepared.prompt.text).toContain('[1] "diagram.png"')
    expect(prepared.prompt.images).toEqual([{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }])
  })

  it('extracts native binary documents when Pi cannot send their raw file shape', async () => {
    const deps: BuiltInConversationDeps = {
      getAttachment: async () => storedFile('report', 'application/pdf'),
      getTransformer: async (_mimeType, target) => (target === 'text' ? async () => ({ text: 'PDF contents' }) : null),
      blobToBase64: async () => '',
    }
    const messages = [
      message('user', [
        {
          type: 'data-attachment',
          data: { localFileId: 'report', filename: 'report.pdf', mimeType: 'application/pdf' },
        },
        { type: 'text', text: 'Summarize it.' },
      ]),
    ]

    const prepared = await prepareBuiltInConversation(messages, undefined, deps)

    expect(prepared.prompt.text).toContain('[Attachment 1: "report.pdf"]\n\nPDF contents\nSummarize it.')
    expect(prepared.prompt.text).toContain('[1] "report.pdf"')
    expect(prepared.prompt.images).toEqual([])
  })

  it('keeps an explicit marker when attachment bytes are unavailable', async () => {
    const deps: BuiltInConversationDeps = {
      getAttachment: async () => null,
      getTransformer: async () => null,
      blobToBase64: async () => '',
    }
    const messages = [
      message('user', [
        {
          type: 'data-attachment',
          data: { localFileId: 'missing', filename: 'missing.bin', mimeType: 'application/octet-stream' },
        },
      ]),
    ]

    const prepared = await prepareBuiltInConversation(messages, undefined, deps)

    // Fork: an unreadable file keeps its number and says plainly that it did not arrive —
    // the user sees its chip, and a numbering that shifted with a disk read would be
    // nondeterministic.
    expect(prepared.prompt.text).toContain('[Attachment 1: "missing.bin"] (file unavailable on this device)')
    expect(prepared.prompt.text).toContain('[1] "missing.bin"')
  })
})
