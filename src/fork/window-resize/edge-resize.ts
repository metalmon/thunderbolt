/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getCurrentWindow } from '@tauri-apps/api/window'
import { getPlatform, isTauri } from '@/lib/platform'

/** Hit zone (CSS px) inside each window edge that starts a native resize drag. */
export const edgeResizeZone = 6

/**
 * Window resize direction, mirroring Tauri's internal `ResizeDirection`.
 * Tauri declares the type but does not export it, so we restate the union
 * here to keep this module free of the Tauri runtime (and unit-testable).
 */
export type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West'

/**
 * Map a pointer position inside the window to a native resize direction,
 * or null when it is not within `zone` px of any edge. Corners win over
 * single edges. Bands are exclusive: west is `x < zone`, east is
 * `x >= width - zone` (same for the vertical axis), so the two half-bands
 * never overlap and a press at `zone` itself is treated as interior.
 */
export const edgeDirectionAt = (
  x: number,
  y: number,
  width: number,
  height: number,
  zone = edgeResizeZone,
): ResizeDirection | null => {
  const west = x < zone
  const east = x >= width - zone
  const north = y < zone
  const south = y >= height - zone

  if (north && west) {
    return 'NorthWest'
  }
  if (north && east) {
    return 'NorthEast'
  }
  if (south && west) {
    return 'SouthWest'
  }
  if (south && east) {
    return 'SouthEast'
  }
  if (west) {
    return 'West'
  }
  if (east) {
    return 'East'
  }
  if (north) {
    return 'North'
  }
  if (south) {
    return 'South'
  }
  return null
}

const skippedSelector = [
  'button',
  '[role="button"]',
  'a',
  'input',
  'textarea',
  'select',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(', ')

/**
 * True when the pressed target is (or sits inside) an interactive control,
 * so a resize gesture never hijacks a click on a real control that happens
 * to sit flush against the window edge (e.g. the custom title-bar buttons).
 */
export const isInteractiveTarget = (target: EventTarget | null | undefined): boolean => {
  if (!(target instanceof Element)) {
    return false
  }
  return target.closest(skippedSelector) !== null
}

/** Direction for a DOM pointer event, using the current viewport as the window bounds. */
export const resizeDirectionFromPointerEvent = (event: PointerEvent): ResizeDirection | null =>
  edgeDirectionAt(event.clientX, event.clientY, window.innerWidth, window.innerHeight)

/** True on the Linux Tauri desktop build, where the window is frameless and native edge-resize is dead. */
export const canLinuxEdgeResize = (): boolean => isTauri() && getPlatform() === 'linux'

/**
 * Document-level pointerdown handler: when the press lands within the edge
 * band (and not on an interactive control), hand the drag to the tauri
 * native resize path (`startResizeDragging`).
 */
export const startLinuxEdgeResize = (event: PointerEvent): void => {
  if (!canLinuxEdgeResize()) {
    return
  }
  const direction = resizeDirectionFromPointerEvent(event)
  if (!direction || isInteractiveTarget(event.target)) {
    return
  }
  event.preventDefault()
  void getCurrentWindow().startResizeDragging(direction)
}
