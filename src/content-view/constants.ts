/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Layout constants for the content view
 */

/** Height of the preview header in pixels */
export const previewHeaderHeight = 48

/** Empirical offset to account for title bar/chrome in Tauri coordinate system */
export const coordinateOffset = 28

/** Border offset for ResizableHandle */
export const borderOffset = 0

/** Minimum width of the content view as threshold percentage - if width is below this, open to default */
export const minimumWidthThreshold = 10

/** Default width of the content view as percentage when opening */
export const defaultOpenWidth = 50

/**
 * Default width of the content view as percentage when opening a `ui://`
 * artifact (mini-app). Wider than `defaultOpenWidth` because an artifact is a
 * full mini-app, not a document preview — see spec §UX "Panel proportions".
 */
export const defaultArtifactOpenWidth = 66
