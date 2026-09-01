/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

let isMobileValue = false
mock.module('@/lib/platform', () => ({ isMobile: () => isMobileValue }))

const { saveBlobUrl } = await import('./save-file')

type Picker = (options?: { suggestedName?: string }) => Promise<unknown>
const picker = globalThis as { showSaveFilePicker?: Picker }
const originalPicker = picker.showSaveFilePicker
const originalFetch = globalThis.fetch

beforeEach(() => {
  isMobileValue = false
  globalThis.fetch = mock(async () => new Response(new Blob(['bytes']))) as unknown as typeof fetch
})

afterEach(() => {
  if (originalPicker) {
    picker.showSaveFilePicker = originalPicker
  } else {
    delete picker.showSaveFilePicker
  }
  globalThis.fetch = originalFetch
})

describe('saveBlobUrl', () => {
  it('writes to the file chosen via the native Save As picker when available', async () => {
    const write = mock(async (_data: Blob) => {})
    const close = mock(async () => {})
    const showSaveFilePicker = mock(async () => ({ createWritable: async () => ({ write, close }) }))
    picker.showSaveFilePicker = showSaveFilePicker as unknown as Picker

    await saveBlobUrl('blob:doc', 'report.docx')

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'report.docx' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the user cancels the picker', async () => {
    picker.showSaveFilePicker = mock(async () => {
      throw new DOMException('cancelled', 'AbortError')
    }) as unknown as Picker
    const clickSpy = mock(() => {})
    const proto = HTMLAnchorElement.prototype as unknown as { click: () => void }
    const originalClick = proto.click
    proto.click = clickSpy

    await saveBlobUrl('blob:doc', 'report.docx')

    expect(clickSpy).not.toHaveBeenCalled()
    proto.click = originalClick
  })

  it('falls back to a silent anchor download when the picker is unavailable', async () => {
    delete picker.showSaveFilePicker
    const clickSpy = mock(() => {})
    const proto = HTMLAnchorElement.prototype as unknown as { click: () => void }
    const originalClick = proto.click
    proto.click = clickSpy

    await saveBlobUrl('blob:doc', 'report.docx')

    expect(clickSpy).toHaveBeenCalledTimes(1)
    proto.click = originalClick
  })

  it('falls back to the anchor download on mobile even when the picker exists', async () => {
    isMobileValue = true
    picker.showSaveFilePicker = mock(async () => ({
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    })) as unknown as Picker
    const clickSpy = mock(() => {})
    const proto = HTMLAnchorElement.prototype as unknown as { click: () => void }
    const originalClick = proto.click
    proto.click = clickSpy

    await saveBlobUrl('blob:doc', 'report.docx')

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(picker.showSaveFilePicker).not.toHaveBeenCalled()
    proto.click = originalClick
  })
})
