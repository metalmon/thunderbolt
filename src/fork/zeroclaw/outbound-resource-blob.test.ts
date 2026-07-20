/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, test, vi } from 'vitest'
import {
  deliveredCaption,
  deliveredLocalFileId,
  enrichToolOutputWithDeliveredFiles,
  extractResourceBlobsFromToolContent,
  filenameFromUri,
  isDeliveredFilesOutput,
  materializeOutboundResourceBlobs,
  toolPartHasDeliveredFiles,
} from './outbound-resource-blob'

describe('filenameFromUri', () => {
  test('takes basename from file uri', () => {
    expect(filenameFromUri('file:///tmp/report.pdf')).toBe('report.pdf')
  })

  test('takes basename from an attachment deliver uri', () => {
    expect(filenameFromUri('attachment://deliver/91ae7de2253c4cc4.pdf')).toBe('91ae7de2253c4cc4.pdf')
  })

  test('falls back when empty', () => {
    expect(filenameFromUri('')).toBe('upload.bin')
  })
})

describe('deliveredLocalFileId', () => {
  test('is deterministic, colon/slash-free, and uri-specific', () => {
    const a = deliveredLocalFileId('attachment://deliver/a.pdf')
    const b = deliveredLocalFileId('attachment://deliver/b.pdf')
    expect(a).toMatch(/^zc-[0-9a-f]{8}$/)
    expect(deliveredLocalFileId('attachment://deliver/a.pdf')).toBe(a) // stable across calls
    expect(a).not.toBe(b) // distinct uris → distinct ids
    expect(a).not.toContain(':')
    expect(a).not.toContain('/')
  })
})

describe('extractResourceBlobsFromToolContent', () => {
  test('pulls nested resource.blob from ACP tool content items', () => {
    const content = [
      { type: 'content', content: { type: 'text', text: 'Delivered report.pdf' } },
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: {
            uri: 'file:///ws/uploads/report.pdf',
            mimeType: 'application/pdf',
            blob: btoa('PDF'),
          },
        },
      },
    ]
    expect(extractResourceBlobsFromToolContent(content)).toEqual([
      {
        uri: 'file:///ws/uploads/report.pdf',
        mimeType: 'application/pdf',
        blob: btoa('PDF'),
      },
    ])
  })

  test('ignores resource without blob', () => {
    const content = [
      {
        type: 'content',
        content: { type: 'resource', resource: { uri: 'file:///x', mimeType: 'text/plain' } },
      },
    ]
    expect(extractResourceBlobsFromToolContent(content)).toEqual([])
  })
})

describe('materializeOutboundResourceBlobs', () => {
  const resourceContent = (uri: string, blob: string) => ({
    type: 'content',
    content: { type: 'resource', resource: { uri, mimeType: 'application/pdf', blob } },
  })

  test('stores the blob under the uri-derived id and returns a matching ref', () => {
    const putAttachment = vi.fn(async (_file: { id: string; blob: Blob }) => {})
    const uri = 'file:///a/doc.pdf'
    const refs = materializeOutboundResourceBlobs([resourceContent(uri, btoa('hello'))], 'Quarterly Report', {
      putAttachment,
      now: () => 123,
    })
    expect(refs).toEqual([
      {
        localFileId: deliveredLocalFileId(uri),
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 5,
        uri,
        title: 'Quarterly Report',
      },
    ])
    expect(putAttachment).toHaveBeenCalledTimes(1)
    // The blob is stored under the SAME deterministic id a widget/citation will recompute.
    expect(putAttachment.mock.calls[0][0].id).toBe(deliveredLocalFileId(uri))
    expect(putAttachment.mock.calls[0][0].blob).toBeInstanceOf(Blob)
  })

  test('preserves delivery order across multiple blobs (drives [N] citations)', () => {
    const putAttachment = vi.fn(async (_file: { id: string; blob: Blob }) => {})
    const refs = materializeOutboundResourceBlobs(
      [resourceContent('file:///a/first.pdf', btoa('one')), resourceContent('file:///b/second.pdf', btoa('two'))],
      undefined,
      { putAttachment, now: () => 123 },
    )
    expect(refs.map((r) => r.uri)).toEqual(['file:///a/first.pdf', 'file:///b/second.pdf'])
    expect(refs.map((r) => r.localFileId)).toEqual([
      deliveredLocalFileId('file:///a/first.pdf'),
      deliveredLocalFileId('file:///b/second.pdf'),
    ])
    // no title given → caption falls back to basename
    expect(refs.map((r) => r.title)).toEqual(['first.pdf', 'second.pdf'])
  })

  test('stores the tool_call_update title on the ref (prose caption)', () => {
    const putAttachment = vi.fn(async (_file: { id: string; blob: Blob }) => {})
    const refs = materializeOutboundResourceBlobs(
      [resourceContent('file:///a/report.pdf', btoa('x'))],
      'Lease Agreement',
      {
        putAttachment,
        now: () => 1,
      },
    )
    expect(refs[0].title).toBe('Lease Agreement')
  })

  test('title falls back to the basename for the legacy "deliver_file" title', () => {
    const putAttachment = vi.fn(async (_file: { id: string; blob: Blob }) => {})
    const refs = materializeOutboundResourceBlobs(
      [resourceContent('file:///a/report.pdf', btoa('x'))],
      'deliver_file',
      {
        putAttachment,
        now: () => 1,
      },
    )
    expect(refs[0].title).toBe('report.pdf')
  })
})

describe('deliveredCaption', () => {
  test('uses the title when present and meaningful', () => {
    expect(deliveredCaption('Lease Agreement', 'a1b2.pdf')).toBe('Lease Agreement')
  })

  test('falls back to basename when title is missing, empty, or the legacy tool name', () => {
    expect(deliveredCaption(undefined, 'a1b2.pdf')).toBe('a1b2.pdf')
    expect(deliveredCaption('', 'a1b2.pdf')).toBe('a1b2.pdf')
    expect(deliveredCaption('   ', 'a1b2.pdf')).toBe('a1b2.pdf')
    expect(deliveredCaption('deliver_file', 'a1b2.pdf')).toBe('a1b2.pdf')
  })
})

describe('enrichToolOutputWithDeliveredFiles', () => {
  test('wraps string rawOutput', () => {
    const out = enrichToolOutputWithDeliveredFiles('Delivered x', [
      {
        localFileId: 'a',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        size: 1,
        uri: 'file:///x.pdf',
        title: 'x.pdf',
      },
    ])
    expect(isDeliveredFilesOutput(out)).toBe(true)
    if (isDeliveredFilesOutput(out)) {
      expect(out.text).toBe('Delivered x')
      expect(out.deliveredFiles[0].filename).toBe('x.pdf')
    }
  })

  test('passthrough when no files', () => {
    expect(enrichToolOutputWithDeliveredFiles('ok', [])).toBe('ok')
  })
})

describe('isDeliveredFilesOutput', () => {
  test('accepts legacy refs that predate the title field', () => {
    // Older persisted output has no `title` (and may carry a now-unused `turnPosition`);
    // it must still validate so old cards keep rendering.
    const legacy = {
      text: 'x',
      deliveredFiles: [
        {
          localFileId: 'r',
          filename: 'a.pdf',
          mimeType: 'application/pdf',
          size: 1,
          uri: 'file:///a.pdf',
          turnPosition: 1,
        },
      ],
    }
    expect(isDeliveredFilesOutput(legacy)).toBe(true)
  })
})

describe('toolPartHasDeliveredFiles', () => {
  test('detects completed tool with deliveredFiles', () => {
    expect(
      toolPartHasDeliveredFiles({
        state: 'output-available',
        output: {
          text: 'x',
          deliveredFiles: [
            {
              localFileId: '1',
              filename: 'a.pdf',
              mimeType: 'application/pdf',
              size: 1,
              uri: 'file:///a.pdf',
              title: 'a.pdf',
            },
          ],
        },
      }),
    ).toBe(true)
    expect(toolPartHasDeliveredFiles({ state: 'output-available', output: { result: 1 } })).toBe(false)
  })
})
