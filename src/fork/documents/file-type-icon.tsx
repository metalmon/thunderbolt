/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

/**
 * File-type icon for the document chip. Wraps `react-file-icon`, which renders a
 * proper, correctly-proportioned document glyph (folded corner, colour-coded label
 * band, per-type accent) from the file extension — the same familiar style used by
 * Dropbox/Box. Bundled (SVG in JS), so it works identically on web and desktop.
 */

import { FileIcon, defaultStyles } from 'react-file-icon'

type FileTypeIconProps = {
  filename: string
  /** Sets the icon width (height follows the document aspect). e.g. `w-7`. */
  className?: string
}

/** react-file-icon's per-extension style presets, indexed by an arbitrary extension. */
const styleFor = (ext: string): Record<string, unknown> =>
  (defaultStyles as Record<string, Record<string, unknown>>)[ext] ?? {}

/**
 * A colour-coded file-type glyph for `filename`, sized via `className` (set the
 * width). Decorative — the chip's filename already labels it — so `aria-hidden`.
 */
export const FileTypeIcon = ({ filename, className }: FileTypeIconProps) => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return (
    <span className={`inline-block [&_svg]:h-auto [&_svg]:w-full ${className ?? ''}`} aria-hidden="true">
      <FileIcon extension={ext} {...styleFor(ext)} />
    </span>
  )
}
