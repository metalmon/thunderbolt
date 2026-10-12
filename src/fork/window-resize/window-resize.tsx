/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEffect } from 'react'
import { canLinuxEdgeResize, edgeCursorAt, isInteractiveTarget, startLinuxEdgeResize } from './edge-resize'

/**
 * Fork: restore frameless window edge/corner resize on Linux, where the
 * WebKit webview swallows the native edge button-press (tauri #8519) and the
 * tao hit-test never starts a resize. Listens once on
 * the document (capture) and forwards edge presses to the tauri native
 * resize path. No-op on every other platform.
 */
export const useLinuxEdgeResize = (): void => {
  useEffect(() => {
    if (!canLinuxEdgeResize()) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => startLinuxEdgeResize(event)

    // Show the resize cursor over the band. Set on the root element rather than the
    // element under the pointer: we must not mutate the app's own styles, and the
    // root is the one node guaranteed to exist. An element that declares its own
    // cursor still wins there — acceptable, since interactive controls are skipped
    // anyway and the band is otherwise window chrome.
    const root = document.documentElement
    let applied = ''
    const setCursor = (value: string): void => {
      if (value === applied) {
        return
      }
      applied = value
      root.style.cursor = value
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (event.buttons !== 0) {
        return // a drag is in progress; leave the cursor to whoever owns it
      }
      const cursor = isInteractiveTarget(event.target)
        ? null
        : edgeCursorAt(event.clientX, event.clientY, window.innerWidth, window.innerHeight)
      setCursor(cursor ?? '')
    }
    const onPointerLeave = (): void => setCursor('')

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
    document.addEventListener('pointerleave', onPointerLeave, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerleave', onPointerLeave, true)
      setCursor('')
    }
  }, [])
}
