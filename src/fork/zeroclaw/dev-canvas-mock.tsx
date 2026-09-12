/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * DEV/TEST-ONLY mock resolver for the Canvas Action Channel (`./canvas-action-channel`).
 *
 * There is no live ZeroClaw in this worktree, so a real `sendMessage(buildCanvasActionMessage(...))`
 * never produces the matching tool part the controller's `findResolvedPending` (`./canvas-pending`)
 * waits for — the pending `tools/call` would hang until the real turn eventually errors out (F1
 * no-hang fallback). This module answers it early with a SYNTHETIC completed tool part instead, so
 * the full round trip (bridge handshake → `tools/call` → pending → resolve → app updates its own
 * DOM) can be exercised end-to-end without a live agent.
 *
 * Deliberately separate from `./canvas-action-channel`: the controller is not imported here and
 * this module is not imported by it either. It is wired ONLY at the mount site
 * (`src/components/chat/chat-messages.tsx`), gated behind the same `uiCanvasMockEnabled()` toggle
 * as `./dev-ui-canvas-inject`, so the production controller path stays completely untouched — no
 * mock logic runs, or even loads, unless that gate is open.
 *
 * Only `tools/call`-carrying actions need a synthetic result: `ui/prompt` (`sendPrompt`) is a
 * notification with no pending JSON-RPC request of its own, and the outbound message already
 * renders as a visible canvas-attributed turn the moment `sendMessage` adds it — nothing to mock.
 */

import { useEffect, useRef } from 'react'
import { isToolOrDynamicToolUIPart, type ToolUIPart } from 'ai'
import type { ThunderboltUIMessage } from '@/types'
import { getCanvasAction, type CanvasActionMeta } from './canvas-action-message'
import { CANVAS_TOOLCALL_PREFIX } from './canvas-call-id'

/** Delay before the mock answers a pending canvas `tools/call`, long enough to observe the pending state in the UI. */
export const DEV_CANVAS_MOCK_DELAY_MS = 600

/** A canvas action found on a `messages` entry, awaiting its synthetic tool result. */
export type UnresolvedCanvasAction = { messageId: string; action: CanvasActionMeta }

/** The wire `toolCallId` a synthetic mock result must carry to match `pending.callId`. */
const mockToolCallId = (callId: string): string => `${CANVAS_TOOLCALL_PREFIX}${callId}`

/**
 * Scan `messages` for canvas-originated user turns whose `tools/call` has no matching completed
 * tool part yet. Mirrors the matching rule `findResolvedPending` (`./canvas-pending`) applies on
 * the controller side, but checks presence only (not state) — once ANY tool part carries the
 * `canvas:<callId>` id, real or synthetic, this stops offering to mock it again.
 *
 * @param messages - the active chat's transcript
 * @returns one entry per canvas action still waiting for a tool result
 */
export const findUnresolvedCanvasActions = (messages: ThunderboltUIMessage[]): UnresolvedCanvasAction[] => {
  const results: UnresolvedCanvasAction[] = []
  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }
    const action = getCanvasAction(message)
    if (!action || !action.toolCall) {
      continue
    }
    const toolCallId = mockToolCallId(action.callId)
    const alreadyHasResult = messages.some((m) =>
      m.parts.some((part) => isToolOrDynamicToolUIPart(part) && (part as ToolUIPart).toolCallId === toolCallId),
    )
    if (!alreadyHasResult) {
      results.push({ messageId: message.id, action })
    }
  }
  return results
}

/**
 * Build the synthetic assistant message carrying a completed tool part for `action`. Its
 * `toolCallId` is exactly what `parseCanvasToolCallId` (`./canvas-call-id`) must recover the
 * controller's `(nonce, appCallId)` pair from, so `findResolvedPending` matches it like any real
 * ACP tool result.
 *
 * The part's `type` mirrors the real ACP translator's `tool-<name>` shape (using the actually
 * requested tool name, falling back to `canvas` only when none was given) — this has no bearing
 * on resolution, which keys on `toolCallId` alone, but matters for a DIFFERENT reason: if the
 * requested name ever happens to be `render_html`, `isRenderHtmlPart` (`@/artifacts/render-html-tool`)
 * would recognize this part, and `groupMessageParts` (`@/lib/assistant-message`) lifts a completed
 * `render_html` part into `ArtifactMessagePart` whenever `renderHtmlOutput(part)?.ok === true` — a
 * bare property check with no further validation of the payload shape. The output below therefore
 * carries NO `ok` key at all (`success`, not `ok`), so it can never satisfy that gate regardless of
 * which tool name a canvas action happens to request.
 *
 * @param action - the canvas action to fabricate a tool result for
 * @returns an assistant message with one `output-available` tool part
 */
export const buildMockCanvasResultMessage = (action: CanvasActionMeta): ThunderboltUIMessage =>
  ({
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [
      {
        type: `tool-${action.toolCall?.name ?? 'canvas'}`,
        toolCallId: mockToolCallId(action.callId),
        state: 'output-available',
        input: action.toolCall?.arguments ?? {},
        output: { success: true, tool: action.toolCall?.name ?? null, echo: action.toolCall?.arguments ?? {} },
      },
    ],
  }) as unknown as ThunderboltUIMessage

/** A `setMessages` updater, matching `@ai-sdk/react`'s `useChat().setMessages` shape. */
type SetMessages = (updater: (prev: ThunderboltUIMessage[]) => ThunderboltUIMessage[]) => void

/**
 * Watches `messages` for canvas actions awaiting a `tools/call` result and answers each one,
 * once, after {@link DEV_CANVAS_MOCK_DELAY_MS}, with a synthetic `output-available` tool part
 * (see {@link buildMockCanvasResultMessage}). Per-`callId` timers live in a ref so a `messages`
 * update that arrives before a timer fires (e.g. the real backend streaming a delta) never
 * cancels/reschedules it — each canvas action is answered exactly once. All outstanding timers
 * are cleared on unmount only, so no `setMessages` call ever fires after this stops being mounted.
 *
 * @param messages - the active chat's transcript
 * @param setMessages - the active chat's `setMessages`, from the SAME `Chat` instance the
 *   Canvas Action Channel controller observes (`useChatStore` → `chatInstance`)
 */
export const useDevCanvasActionMock = (messages: ThunderboltUIMessage[], setMessages: SetMessages): void => {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    },
    [],
  )

  useEffect(() => {
    for (const { action } of findUnresolvedCanvasActions(messages)) {
      if (timersRef.current.has(action.callId)) {
        continue
      }
      const timer = setTimeout(() => {
        timersRef.current.delete(action.callId)
        setMessages((prev) => [...prev, buildMockCanvasResultMessage(action)])
      }, DEV_CANVAS_MOCK_DELAY_MS)
      timersRef.current.set(action.callId, timer)
    }
  }, [messages, setMessages])
}

/**
 * Mount-point wrapper so the mock can be gated exactly like `DevUiCanvasInject`
 * (`{uiCanvasMockEnabled() && <DevCanvasActionMock ... />}`) at its call site
 * (`src/components/chat/chat-messages.tsx`). Renders nothing — the mock is pure side effect.
 */
export const DevCanvasActionMock = ({
  messages,
  setMessages,
}: {
  messages: ThunderboltUIMessage[]
  setMessages: SetMessages
}) => {
  useDevCanvasActionMock(messages, setMessages)
  return null
}
