/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Icon for a `ui://` canvas artifact in the transcript chip. Rendered with the SAME
 * `react-file-icon` collection as the document chips (`file-type-icon.tsx`) — same
 * page shape, fold and label band — so canvas and file chips are visually one family.
 * Themed indigo with an "APP" label + code glyph to read as an interactive artifact
 * rather than a document.
 */

import { FileIcon } from 'react-file-icon'

type CanvasArtifactIconProps = {
  /** Sets the icon width (height follows the document aspect). e.g. `w-7`. */
  className?: string
}

export const CanvasArtifactIcon = ({ className }: CanvasArtifactIconProps) => (
  <span className={`inline-block [&_svg]:h-auto [&_svg]:w-full ${className ?? ''}`} aria-hidden="true">
    <FileIcon
      extension="app"
      color="#eef2ff"
      foldColor="#c7d2fe"
      glyphColor="#4f46e5"
      labelColor="#4f46e5"
      labelTextColor="#ffffff"
      labelUppercase
      type="code"
    />
  </span>
)
