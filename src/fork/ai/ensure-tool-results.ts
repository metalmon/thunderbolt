/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ModelMessage } from 'ai'

type ToolCallPart = {
  type: string
  toolCallId?: string
  toolName?: string
  providerExecuted?: boolean
}

type ToolResultPart = {
  type: string
  toolCallId?: string
}

type OpenCall = { toolCallId: string; toolName: string }

/**
 * Guarantee that every assistant `tool-call` in a model-message list has a
 * matching `tool-result` before the next `user`/`system` message or the end of
 * the list — the exact invariant the AI SDK enforces in `streamText`'s prompt
 * standardization (`MissingToolResultsError`).
 *
 * Why this exists: the built-in retry loop (`src/ai/fetch.ts`) appends a
 * `{ role: 'user' }` nudge after `streamText`'s `response.messages`. When a turn
 * is torn down before a tool resolves — an overlapping voice `submit_prompt`
 * starting a second turn on the same chat, or an approval-gated / no-execute
 * tool — `response.messages` ends on an unresolved `tool-call`, and that
 * trailing user nudge makes the SDK throw `MissingToolResultsError` (surfaced as
 * "Tool result is missing for tool call …", retried to no effect). Rather than
 * let a half-finished tool call crash the whole turn, we synthesize an
 * error-text result for each unresolved call so the model sees the call failed
 * and can proceed. Balanced input passes through byte-for-byte unchanged.
 *
 * Synthetic results are inserted immediately after the assistant turn's real
 * tool results (or, if none, immediately after the assistant message), so the
 * provider always receives tool results adjacent to their originating
 * assistant message.
 */
export const ensureToolResults = (messages: readonly ModelMessage[]): ModelMessage[] => {
  const result: ModelMessage[] = []
  let openCalls: OpenCall[] = []

  const flushSyntheticResults = (): void => {
    if (openCalls.length === 0) {
      return
    }
    result.push({
      role: 'tool',
      content: openCalls.map((call) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { type: 'error-text' as const, value: 'The tool call was interrupted before it produced a result.' },
      })),
    } as ModelMessage)
    openCalls = []
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      const resolved = new Set(
        (message.content as ToolResultPart[])
          .filter((part) => part.type === 'tool-result' && typeof part.toolCallId === 'string')
          .map((part) => part.toolCallId as string),
      )
      openCalls = openCalls.filter((call) => !resolved.has(call.toolCallId))
      result.push(message)
      continue
    }

    // Any non-tool message closes the current assistant turn's tool window:
    // synthesize results for whatever is still open before it lands.
    flushSyntheticResults()
    result.push(message)

    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content as ToolCallPart[]) {
        if (part.type === 'tool-call' && !part.providerExecuted && typeof part.toolCallId === 'string') {
          openCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName ?? 'unknown' })
        }
      }
    }
  }

  flushSyntheticResults()
  return result
}
