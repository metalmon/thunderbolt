/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Icon for a `ui://` canvas artifact in the transcript chip — a filled, colour-coded
 * "app window / mini-dashboard" glyph, sized and styled to match the document chip's
 * `react-file-icon` icons so canvas and file chips read as one family. A distinct
 * indigo signals "interactive app", set apart from the document colours.
 */

type CanvasArtifactIconProps = {
  /** Sets the icon size. e.g. `w-7`. */
  className?: string
}

export const CanvasArtifactIcon = ({ className }: CanvasArtifactIconProps) => (
  <svg viewBox="0 0 28 34" className={className} fill="none" role="img" aria-hidden="true">
    {/* window body */}
    <rect x="2" y="5" width="24" height="24" rx="3.5" fill="#4f46e5" />
    {/* title bar */}
    <rect x="2" y="5" width="24" height="6" rx="3.5" fill="#ffffff" fillOpacity="0.18" />
    <circle cx="5.5" cy="8" r="1" fill="#ffffff" fillOpacity="0.7" />
    <circle cx="8.7" cy="8" r="1" fill="#ffffff" fillOpacity="0.7" />
    {/* dashboard panels */}
    <rect x="5" y="14.5" width="8" height="10" rx="1.4" fill="#ffffff" fillOpacity="0.9" />
    <rect x="15" y="14.5" width="8" height="4.5" rx="1.2" fill="#ffffff" fillOpacity="0.9" />
    <rect x="15" y="20.5" width="8" height="4" rx="1.2" fill="#ffffff" fillOpacity="0.6" />
  </svg>
)
