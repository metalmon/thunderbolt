/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { defaultArtifactOpenWidth, defaultOpenWidth, minimumWidthThreshold } from '@/content-view/constants'

/**
 * Pure computation of the content-view panel's open-animation target width,
 * per view type (spec §UX "Panel proportions"). A `ui://` artifact is a
 * mini-app and opens wider than a document/preview/object-view.
 *
 * @param stateType - `useContentView().state.type` (`'artifact'` or any other
 *   view type / `null`)
 * @param artifactWidth - the persisted `artifact_view_width` setting value
 * @param contentWidth - the persisted `content_view_width` setting value
 * @returns the target width as a percentage (0-100)
 */
export const openTargetWidth = (
  stateType: string | null,
  artifactWidth: number | null,
  contentWidth: number | null,
): number => {
  const isArtifact = stateType === 'artifact'
  const savedWidth = isArtifact ? artifactWidth : contentWidth
  const defaultWidth = isArtifact ? defaultArtifactOpenWidth : defaultOpenWidth
  const hasSavedWidthAboveThreshold = savedWidth !== null && savedWidth >= minimumWidthThreshold
  return hasSavedWidthAboveThreshold ? savedWidth : defaultWidth
}
