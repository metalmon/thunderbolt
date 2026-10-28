/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Controllable stand-in for docx-preview's `renderAsync` — each test swaps the
// implementation to exercise the ready / error branches and to plant the kind of
// markup a hostile document would produce.
let renderImpl: (...args: unknown[]) => Promise<void>
const renderAsyncMock = mock((...args: unknown[]) => renderImpl(...args))
mock.module('docx-preview', () => ({ renderAsync: renderAsyncMock }))

// Lingui macros are mocked to identity implementations globally in
// src/testing-library.ts (a bunfig preload), so `t` renders the English source
// text with the file name interpolated — assertions match on that below.

const originalFetch = globalThis.fetch

beforeEach(() => {
  renderAsyncMock.mockClear()
  renderImpl = async () => {}
  // The component fetches the blobUrl to obtain the file bytes.
  globalThis.fetch = mock(async () => new Response(new Blob(['docx-bytes']))) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

const { DocxPreview } = await import('./docx-preview')

/** What a hostile document gives docx-preview to build: a link that would run in
 *  whichever origin renders it. OOXML carries no script, so this is the vector. */
const plantHostileLink = () => {
  renderImpl = async (...args: unknown[]) => {
    const target = args[1] as HTMLElement
    const link = target.ownerDocument.createElement('a')
    link.href = 'javascript:fetch("/steal")'
    link.textContent = 'Open report'
    target.append(link)
  }
}

describe('DocxPreview', () => {
  it('builds the document in a detached document, never in the app DOM', async () => {
    render(<DocxPreview blobUrl="blob:doc" fileName="report.docx" />)

    await waitFor(() => expect(renderAsyncMock).toHaveBeenCalledTimes(1))

    expect(globalThis.fetch).toHaveBeenCalledWith('blob:doc')
    const [blobArg, targetArg, , optionsArg] = renderAsyncMock.mock.calls[0]
    expect(blobArg).toBeInstanceOf(Blob)
    const target = targetArg as HTMLElement
    // The target belongs to another document entirely, so nothing the library
    // builds is reachable from the page the app runs in. (`isConnected` would say
    // true here: it means "attached to ITS own document", which this body is.)
    expect(target.ownerDocument).not.toBe(document)
    expect(document.contains(target)).toBe(false)
    // blob: URLs belong to this origin and the frame's origin is opaque, so the
    // images have to be inlined or they silently fail to load.
    expect(optionsArg).toMatchObject({ useBase64URL: true })
    expect(screen.queryByText(/Could not render/)).toBeNull()
  })

  it('hands the markup to a frame with an empty sandbox', async () => {
    render(<DocxPreview blobUrl="blob:doc" fileName="report.docx" />)

    const frame = await waitFor(() => {
      const el = document.querySelector('iframe')
      expect(el).not.toBeNull()
      return el as HTMLIFrameElement
    })
    // Empty, not merely present: `allow-scripts` would restore the vector, and
    // `allow-same-origin` would put the document back in reach of the IPC.
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('<!doctype html>')
  })

  it('keeps a javascript: link out of the app DOM', async () => {
    plantHostileLink()
    render(<DocxPreview blobUrl="blob:doc" fileName="report.docx" />)

    const frame = await waitFor(() => {
      const el = document.querySelector('iframe')
      expect(el).not.toBeNull()
      return el as HTMLIFrameElement
    })
    // Confined, not dropped: the link still reaches the frame (the document is
    // shown as it is), but nothing clickable lands in the origin holding the IPC.
    expect(frame.getAttribute('srcdoc')).toContain('javascript:fetch')
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('shows a download-fallback message when rendering fails', async () => {
    renderImpl = async () => {
      throw new Error('corrupt docx')
    }
    render(<DocxPreview blobUrl="blob:bad" fileName="broken.docx" />)

    await waitFor(() => expect(screen.getByText(/Could not render/)).toBeTruthy())
    expect(screen.getByText(/broken\.docx/)).toBeTruthy()
  })
})
