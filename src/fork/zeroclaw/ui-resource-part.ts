/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { isToolOrDynamicToolUIPart, type ToolUIPart } from 'ai'
import type { ToolOrDynamicToolUIPart } from '@/lib/assistant-message'
import { isUiResourceOutput, type UiResourceRef } from './ui-resource'

/** True when a UI part is a completed tool part carrying a `ui://` UI-resource output. */
export const isUiResourcePart = (part: unknown): part is ToolOrDynamicToolUIPart =>
  isToolOrDynamicToolUIPart(part as never) &&
  (part as ToolUIPart).state === 'output-available' &&
  isUiResourceOutput((part as ToolUIPart).output)

/** The `ui://` resource of a part, or null if it is not a ui-resource part. */
export const uiResourceOfPart = (part: unknown): UiResourceRef | null =>
  isUiResourcePart(part) ? ((part as ToolUIPart).output as { uiResource: UiResourceRef }).uiResource : null
