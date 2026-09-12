/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Canvas Action Channel — send seam.
 *
 * A canvas action (a control activated inside a `ui://` artifact) rides to
 * the agent as an ordinary chat message: a `role:'user'` `ThunderboltUIMessage`
 * carrying a `metadata.canvasAction` marker. The ACP adapter (thin hook in
 * `src/acp/acp-adapter.ts`) reads that marker off the outbound request's last
 * message and re-derives it as `_meta["io.modelcontextprotocol/ui"]` on the
 * wire `session/prompt` call — see `./canvas-negotiation` for `CANVAS_META_KEY`.
 *
 * `callId` here is ALREADY COMPOSED by the caller (`<nonce>:<appId>`, see
 * `./canvas-call-id`'s `composeCanvasCallId`) — nothing in this module composes
 * or parses it.
 *
 * Two shapes exist:
 *  - Tool-only (no `prompt`): a silent turn — the user never asked anything,
 *    a canvas control just fired a tool. The message text is a synthetic,
 *    model-facing directive so `buildPromptBlocks` has non-empty text to send.
 *    Not rendered as a chat bubble (`isHiddenCanvasTurn`).
 *  - Prompt-bearing: the canvas control composed an actual user-visible ask.
 *    Rendered, but attributed to the canvas rather than presented as if the
 *    user typed it themselves (`isCanvasOriginTurn`).
 */

import { isToolOrDynamicToolUIPart, type ToolUIPart } from 'ai'
import type { ThunderboltUIMessage, UIMessageMetadata } from '@/types'
import { parseCanvasToolCallId } from './canvas-call-id'
import { CANVAS_META_KEY } from './canvas-negotiation'
import { isUiResourcePart } from './ui-resource-part'

/** A canvas-originated action, carried on a chat message's `metadata.canvasAction`. */
export type CanvasActionMeta = {
  /** The tool the canvas control asked the agent to invoke, if any. */
  toolCall?: { name: string; arguments?: Record<string, unknown> }
  /** User-visible ask composed by the canvas control, if any (absent = silent/tool-only turn). */
  prompt?: string
  /** The `ui://` resource URI the action originated from. */
  uri: string
  /** Already-composed wire call id (`<nonce>:<appId>`) — see `composeCanvasCallId`. */
  callId: string
}

/**
 * Synthetic, model-facing directive used as the message text for a tool-only
 * canvas turn (no user-visible prompt). English on purpose — model-facing text
 * stays untranslated per the i18n rules (see CLAUDE.md § Localization).
 */
export const SYNTHETIC_TOOL_DIRECTIVE =
  'A control in the canvas UI was activated; run the tool named in _meta["io.modelcontextprotocol/ui"].'

/** A message shape sufficient to read/write `metadata.canvasAction` without depending on the full `ThunderboltUIMessage`. */
type CanvasCarrierMessage = { metadata?: UIMessageMetadata }

/**
 * Build the chat message that carries a canvas action to the agent.
 *
 * @param action - the canvas action to send
 * @returns a single-text-part message with `metadata.canvasAction` set; the
 *   text is the action's `prompt` when present, otherwise {@link SYNTHETIC_TOOL_DIRECTIVE}
 *   — always non-empty, so `buildPromptBlocks` never throws on empty content.
 */
export const buildCanvasActionMessage = (
  action: CanvasActionMeta,
): { parts: { type: 'text'; text: string }[]; metadata: UIMessageMetadata } => ({
  parts: [{ type: 'text', text: action.prompt ?? SYNTHETIC_TOOL_DIRECTIVE }],
  metadata: { canvasAction: action },
})

/**
 * Read the canvas action off a chat message, if any.
 *
 * @param message - any object carrying an optional `metadata`
 * @returns the `CanvasActionMeta`, or null if the message is not canvas-originated
 */
export const getCanvasAction = (message: CanvasCarrierMessage): CanvasActionMeta | null =>
  message.metadata?.canvasAction ?? null

/**
 * Derive the outbound ACP `_meta` fragment for a canvas action, nested under
 * {@link CANVAS_META_KEY}. Optional fields (`toolCall`, `prompt`) are omitted
 * entirely when absent rather than sent as `undefined`/`null`.
 *
 * @param action - the canvas action attached to the outbound message
 * @returns the `_meta` object to spread onto the `session/prompt` request
 */
export const buildCanvasWireMeta = (action: CanvasActionMeta): Record<string, unknown> => ({
  [CANVAS_META_KEY]: {
    ...(action.toolCall ? { toolCall: action.toolCall } : {}),
    ...(action.prompt ? { prompt: action.prompt } : {}),
    uri: action.uri,
    callId: action.callId,
  },
})

/**
 * A tool-only canvas turn: the canvas fired a tool with no user-visible
 * prompt, so the turn must not render as a chat bubble.
 *
 * @param message - the chat message to test
 */
export const isHiddenCanvasTurn = (message: CanvasCarrierMessage): boolean => {
  const action = getCanvasAction(message)
  return action != null && !action.prompt
}

/**
 * A prompt-bearing canvas turn: rendered, but attributed to the canvas rather
 * than presented as the user's own message.
 *
 * @param message - the chat message to test
 */
export const isCanvasOriginTurn = (message: CanvasCarrierMessage): boolean => {
  const action = getCanvasAction(message)
  return action != null && !!action.prompt
}

/**
 * The ASSISTANT-side counterpart of {@link isHiddenCanvasTurn}: the reply to a
 * tool-only canvas action (no user-visible prompt) carries the tool result as
 * a `canvas:`-prefixed tool part and no model text, so it must not render as
 * a chat bubble either (spec §9 "no new chat bubble").
 *
 * Deliberately conservative — matches only a PURE canvas-origin tool-result
 * turn, so it can never suppress a normal assistant turn:
 *  - any non-empty `text` part (a `ui/prompt` answer or combined-mode
 *    narration) makes the turn visible;
 *  - a `ui://` resource part (the canvas emission itself, via
 *    `UiResourceChip`/{@link isUiResourcePart}) always makes the turn
 *    visible, even if its `toolCallId` happened to carry the canvas prefix;
 *  - any tool part whose `toolCallId` is NOT canvas-origin (per
 *    {@link parseCanvasToolCallId}) — e.g. a `deliver_file` call the model
 *    made on its own — makes the turn visible;
 *  - reasoning, source, file, or any other part type makes the turn visible;
 *  - a message with zero parts (the in-flight placeholder) is never hidden
 *    by this predicate — that state is handled elsewhere.
 *
 * @param message - the chat message to test
 */
export const isHiddenCanvasAssistantTurn = (message: Pick<ThunderboltUIMessage, 'role' | 'parts'>): boolean => {
  if (message.role !== 'assistant') {
    return false
  }
  const parts = message.parts
  if (!parts || parts.length === 0) {
    return false
  }

  let hasCanvasToolPart = false
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text.trim() !== '') {
        return false
      }
      continue
    }
    if (isToolOrDynamicToolUIPart(part)) {
      if (isUiResourcePart(part) || parseCanvasToolCallId((part as ToolUIPart).toolCallId) == null) {
        return false
      }
      hasCanvasToolPart = true
      continue
    }
    // reasoning, source, file, step-start, or any other visible content
    return false
  }
  return hasCanvasToolPart
}
