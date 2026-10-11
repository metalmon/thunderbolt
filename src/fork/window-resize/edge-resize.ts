/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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
