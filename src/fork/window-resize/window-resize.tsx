/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useEffect } from 'react'
import { canLinuxEdgeResize, startLinuxEdgeResize } from './edge-resize'

/**
 * Fork: restore frameless window edge/corner resize on Linux, where the
 * WebKit webview swallows the native edge button-press (tauri #8519) and the
 * tao hit-test never starts a resize (see the design doc). Listens once on
 * the document (capture) and forwards edge presses to the tauri native
 * resize path. No-op on every other platform.
 */
export const useLinuxEdgeResize = (): void => {
  useEffect(() => {
    if (!canLinuxEdgeResize()) {
      return
    }
    const onPointerDown = (event: PointerEvent): void => startLinuxEdgeResize(event)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [])
}
