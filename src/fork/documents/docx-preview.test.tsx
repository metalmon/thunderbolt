/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

// Controllable stand-in for docx-preview's `renderAsync` — each test swaps the
// implementation to exercise the ready / error branches.
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

describe('DocxPreview', () => {
  it('feeds the fetched blob and the scoped container into docx-preview renderAsync', async () => {
    render(<DocxPreview blobUrl="blob:doc" fileName="report.docx" />)

    await waitFor(() => expect(renderAsyncMock).toHaveBeenCalledTimes(1))

    expect(globalThis.fetch).toHaveBeenCalledWith('blob:doc')
    const [blobArg, containerArg] = renderAsyncMock.mock.calls[0]
    expect(blobArg).toBeInstanceOf(Blob)
    expect(containerArg).toBe(document.querySelector('.docx-viewer'))
    expect(screen.queryByText(/Could not render/)).toBeNull()
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
