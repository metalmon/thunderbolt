/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * `buildPromptBlocks` attachment delivery (THU-628). Focuses on the no-
 * `embeddedContext` graceful-degradation branch: a text-extractable file is sent
 * as a `text` block; anything else gets a visible "could not be delivered" note
 * rather than being silently dropped.
 *
 * File deps (`getTransformer`/`getAttachment`) are injected rather than mocked at
 * the module level — a `mock.module` here would leak across test files in bun's
 * shared process.
 */

import { describe, expect, test } from 'bun:test'
import type { StoredFile } from '@/lib/file-blob-storage'
import { buildAttachmentPart } from '@/lib/attachments'
import { buildQuotePart } from '@/lib/quotes'
import { buildPromptBlocks, type PromptBlockDeps } from './acp-adapter'

// PDF has a text transformer; everything else (e.g. images) has none. The
// transformer ignores the file bytes, so any non-null StoredFile will do.
const deps: PromptBlockDeps = {
  getTransformer: async (mime, target) =>
    mime === 'application/pdf' && target === 'text' ? async () => ({ text: 'EXTRACTED PDF TEXT' }) : null,
  getAttachment: async () => ({ blob: new Blob(['x']) }) as StoredFile,
}

type Block = { type: string; text?: string }

const initWith = (parts: unknown[]): RequestInit => ({
  body: JSON.stringify({ messages: [{ id: 'm1', role: 'user', parts }] }),
})

const pdf = () => buildAttachmentPart({ localFileId: 'f1', filename: 'doc.pdf', mimeType: 'application/pdf' })
const png = () => buildAttachmentPart({ localFileId: 'f2', filename: 'pic.png', mimeType: 'image/png' })
const textPart = (text: string) => ({ type: 'text', text })

// The fork always prepends the deliver cite note as the first prompt block
// (composeAcpPrompt, always-on for ACP). First-text-block expectations carry it.
const expectedPromptText = (text: string) => text

type ResourceBlock = { type: string; text?: string; resource?: { uri: string; mimeType: string; blob: string } }

describe('buildPromptBlocks — no embeddedContext', () => {
  test('sends a text-extractable file as an extracted text block', async () => {
    const blocks = (await buildPromptBlocks(initWith([textPart('hi'), pdf()]), undefined, false, deps)) as Block[]

    // Fork: the marker is its own block and carries the number the reply cites, and the
    // first block gains the note naming that number. See
    // docs/development/attachment-citations.md.
    expect(blocks).toHaveLength(3)
    expect(blocks[0]?.text).toContain(expectedPromptText('hi'))
    expect(blocks[0]?.text).toContain('[1] "doc.pdf"')
    expect(blocks[1]).toEqual({ type: 'text', text: '[Attachment 1: "doc.pdf"]' })
    expect(blocks[2]?.text).toBe('EXTRACTED PDF TEXT')
  })

  test('flags a non-text file as undeliverable instead of dropping it silently', async () => {
    const blocks = (await buildPromptBlocks(initWith([textPart('hi'), png()]), undefined, false, deps)) as Block[]

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toContain('hi')
    expect(blocks[0]?.text).toContain('[Attachment "pic.png" could not be delivered to this agent]')
  })

  test('mixes both: text block for the PDF, note for the image', async () => {
    const blocks = (await buildPromptBlocks(
      initWith([textPart('hi'), pdf(), png()]),
      undefined,
      false,
      deps,
    )) as Block[]

    expect(blocks).toHaveLength(3)
    expect(blocks[0]?.text).toContain('[Attachment "pic.png" could not be delivered to this agent]')
    // The undeliverable note still names only the file that failed.
    expect(blocks[0]?.text).not.toContain('"doc.pdf" could not be delivered')
    expect(blocks[1]).toEqual({ type: 'text', text: '[Attachment 1: "doc.pdf"]' })
    expect(blocks[2]?.text).toBe('EXTRACTED PDF TEXT')
  })

  test('with no attachments, returns a single text block (no note)', async () => {
    const blocks = (await buildPromptBlocks(initWith([textPart('just text')]), undefined, false, deps)) as Block[]

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: 'text', text: expectedPromptText('just text') })
  })
})

describe('buildPromptBlocks — embeddedContext', () => {
  test('sends native bytes as an embedded resource by default', async () => {
    const blocks = (await buildPromptBlocks(
      initWith([textPart('hi'), pdf()]),
      undefined,
      true,
      deps,
    )) as ResourceBlock[]

    // Fork: a resource block carries no text, so the marker naming its citation number
    // is a block of its own in front of it — this is the path docx and PDF take.
    expect(blocks).toHaveLength(3)
    expect(blocks[0]?.text).toContain(expectedPromptText('hi'))
    expect(blocks[1]).toEqual({ type: 'text', text: '[Attachment 1: "doc.pdf"]' })
    expect(blocks[2]?.type).toBe('resource')
    expect(blocks[2]?.resource?.uri).toBe('attachment://f1/doc.pdf')
    expect(blocks[2]?.resource?.mimeType).toBe('application/pdf')
    expect(typeof blocks[2]?.resource?.blob).toBe('string')
  })

  test('honors deliverAs: text from remediation — sends extracted text, not native bytes', async () => {
    const remediated = buildAttachmentPart({
      localFileId: 'f1',
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      deliverAs: 'text',
    })
    const blocks = (await buildPromptBlocks(initWith([textPart('hi'), remediated]), undefined, true, deps)) as Block[]

    expect(blocks).toHaveLength(3)
    expect(blocks[0]?.text).toContain(expectedPromptText('hi'))
    expect(blocks[1]).toEqual({ type: 'text', text: '[Attachment 1: "doc.pdf"]' })
    expect(blocks[2]?.text).toBe('EXTRACTED PDF TEXT')
  })

  test('flags a file missing from IndexedDB as undeliverable instead of dropping it silently', async () => {
    const missingDeps: PromptBlockDeps = { ...deps, getAttachment: async () => null }
    const blocks = (await buildPromptBlocks(initWith([textPart('hi'), pdf()]), undefined, true, missingDeps)) as Block[]

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toContain('hi')
    expect(blocks[0]?.text).toContain('[Attachment "doc.pdf" could not be delivered to this agent]')
  })
})

describe('buildPromptBlocks — quotes', () => {
  const quote = (text: string) => buildQuotePart({ text, sourceMessageId: 'm0' })

  test('prepends the quoted passage as a Markdown blockquote ahead of the reply text', async () => {
    const blocks = (await buildPromptBlocks(
      initWith([quote('the mitochondria is the powerhouse of the cell'), textPart('is this right?')]),
      undefined,
      false,
      deps,
    )) as Block[]

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toBe(
      expectedPromptText('> the mitochondria is the powerhouse of the cell\n\nis this right?'),
    )
  })

  test('sends a quote-only reply (no typed text) as the blockquote alone', async () => {
    const blocks = (await buildPromptBlocks(initWith([quote('quoted line')]), undefined, false, deps)) as Block[]

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.text).toBe(expectedPromptText('> quoted line'))
  })

  test('carries quotes through the embeddedContext path alongside attachments', async () => {
    const blocks = (await buildPromptBlocks(
      initWith([quote('context'), textPart('summarize'), pdf()]),
      undefined,
      true,
      deps,
    )) as Block[]

    expect(blocks[0]?.text).toContain(expectedPromptText('> context\n\nsummarize'))
    expect(blocks[1]).toEqual({ type: 'text', text: '[Attachment 1: "doc.pdf"]' })
    expect(blocks[2]?.type).toBe('resource')
  })
})
