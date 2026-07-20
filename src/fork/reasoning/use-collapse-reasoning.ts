/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { useSettings } from '@/hooks/use-settings'

/**
 * Whether AI reasoning should render collapsed by default (live streaming preview
 * suppressed, header only). Reads the synced `collapse_reasoning_by_default`
 * setting; defaults to true when unset. Consumed by the thin seam in
 * `reasoning-group.tsx`.
 */
export const useCollapseReasoning = (): boolean =>
  useSettings({ collapse_reasoning_by_default: true }).collapseReasoningByDefault.value
