/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, test, vi, beforeEach } from 'vitest'
import { clearDeliveredUriRefMap, getDeliveredUriRefByUri } from './delivered-uri-ref-map'
import {
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

  test('falls back when empty', () => {
    expect(filenameFromUri('')).toBe('upload.bin')
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
  beforeEach(() => {
    clearDeliveredUriRefMap()
  })

  test('stores decoded bytes and returns local refs', () => {
    const putAttachment = vi.fn(async (_file: { id: string; blob: Blob }) => {})
    const content = [
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: { uri: 'file:///a/doc.pdf', mimeType: 'application/pdf', blob: btoa('hello') },
        },
      },
    ]
    const refs = materializeOutboundResourceBlobs(content, {
      putAttachment,
      randomId: () => 'id-1',
      now: () => 123,
    })
    expect(refs).toEqual([
      {
        localFileId: 'id-1',
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 5,
        uri: 'file:///a/doc.pdf',
        turnPosition: 1,
      },
    ])
    expect(putAttachment).toHaveBeenCalledTimes(1)
    expect(putAttachment.mock.calls[0][0].id).toBe('id-1')
    expect(putAttachment.mock.calls[0][0].blob).toBeInstanceOf(Blob)
  })

  test('registers ref-map entry with uri and turnPosition', () => {
    const putAttachment = vi.fn(async (_file: { id: string; blob: Blob }) => {})
    const content = [
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: { uri: 'file:///a/doc.pdf', mimeType: 'application/pdf', blob: btoa('hello') },
        },
      },
    ]
    materializeOutboundResourceBlobs(content, {
      putAttachment,
      randomId: () => 'id-1',
      now: () => 123,
    })
    expect(getDeliveredUriRefByUri('file:///a/doc.pdf')).toEqual({
      uri: 'file:///a/doc.pdf',
      localFileId: 'id-1',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'doc.pdf',
    })
  })

  test('assigns increasing turnPosition for multiple blobs', () => {
    const putAttachment = vi.fn(async (_file: { id: string; blob: Blob }) => {})
    let id = 0
    const content = [
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: { uri: 'file:///a/first.pdf', mimeType: 'application/pdf', blob: btoa('one') },
        },
      },
      {
        type: 'content',
        content: {
          type: 'resource',
          resource: { uri: 'file:///b/second.pdf', mimeType: 'application/pdf', blob: btoa('two') },
        },
      },
    ]
    const refs = materializeOutboundResourceBlobs(content, {
      putAttachment,
      randomId: () => `id-${++id}`,
      now: () => 123,
    })
    expect(refs.map((r) => r.turnPosition)).toEqual([1, 2])
    expect(getDeliveredUriRefByUri('file:///a/first.pdf')?.turnPosition).toBe(1)
    expect(getDeliveredUriRefByUri('file:///b/second.pdf')?.turnPosition).toBe(2)
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
        turnPosition: 1,
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
              turnPosition: 1,
            },
          ],
        },
      }),
    ).toBe(true)
    expect(toolPartHasDeliveredFiles({ state: 'output-available', output: { result: 1 } })).toBe(false)
  })
})
