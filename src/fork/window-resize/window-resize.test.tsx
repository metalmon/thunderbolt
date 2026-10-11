/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { cleanup, renderHook } from '@testing-library/react'
import * as tauriWindow from '@tauri-apps/api/window'
import * as platformModule from '@/lib/platform'
import { useLinuxEdgeResize } from './window-resize'

describe('useLinuxEdgeResize', () => {
  let originalInnerWidth: number
  let originalInnerHeight: number

  beforeEach(() => {
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
  })

  afterEach(() => {
    cleanup()
    mock.restore()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
  })

  const makeEdgeEvent = () =>
    new PointerEvent('pointerdown', { clientX: 1397, clientY: 300, bubbles: true, cancelable: true })

  it('starts a native resize for an edge pointerdown while mounted', () => {
    spyOn(platformModule, 'isTauri').mockImplementation(() => true)
    spyOn(platformModule, 'getPlatform').mockImplementation(() => 'linux' as never)
    const startResizeDragging = mock()
    spyOn(tauriWindow, 'getCurrentWindow').mockImplementation(() => ({ startResizeDragging }) as never)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })

    const { unmount } = renderHook(() => useLinuxEdgeResize())

    const event = makeEdgeEvent()
    document.dispatchEvent(event)
    expect(startResizeDragging).toHaveBeenCalledTimes(1)
    expect(startResizeDragging).toHaveBeenCalledWith('East')
    expect(event.defaultPrevented).toBe(true)

    unmount()
    startResizeDragging.mockClear()
    document.dispatchEvent(makeEdgeEvent())
    expect(startResizeDragging).not.toHaveBeenCalled()
  })

  it('never attaches its listener outside the Linux Tauri build', () => {
    spyOn(platformModule, 'isTauri').mockImplementation(() => false)
    const startResizeDragging = mock()
    spyOn(tauriWindow, 'getCurrentWindow').mockImplementation(() => ({ startResizeDragging }) as never)

    const { unmount } = renderHook(() => useLinuxEdgeResize())

    document.dispatchEvent(makeEdgeEvent())
    expect(startResizeDragging).not.toHaveBeenCalled()

    unmount()
  })
})
