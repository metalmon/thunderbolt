/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Emitting-agent stamp — pure helpers backing the agent-switch read-only
 * snapshot gate (Task 9). A `ui://` canvas is bound to the `Agent.id` that
 * emitted it; if the thread's selected agent changes afterward, the canvas
 * becomes a read-only snapshot instead of silently routing the next click to
 * a different agent (see `./canvas-action-channel`).
 */

import type { ThunderboltUIMessage, UIMessageMetadata } from '@/types'

/**
 * Stamp `agentId` onto `metadata` as `emittingAgentId`, but only when no
 * stamp is present yet. A message is stamped once, at turn completion
 * (`src/chats/chat-instance.ts`); re-stamping an already-stamped message
 * (e.g. a duplicate `onFinish` or a rehydrate-time reconciliation) must
 * never overwrite it — the whole point is that the historical emitter
 * survives, so the gate keeps comparing against the agent that actually
 * produced the canvas.
 */
export const stampEmittingAgent = (metadata: UIMessageMetadata | undefined, agentId: string): UIMessageMetadata => ({
  ...metadata,
  emittingAgentId: metadata?.emittingAgentId ?? agentId,
})

/**
 * Read the `Agent.id` that emitted `message`, or `null` if it was never
 * stamped — either a legacy message persisted before this field existed, or
 * a non-assistant message. `null` is treated as "unknown emitter" by the
 * gate, which allows the action through rather than regressing pre-Task-9
 * canvases into a permanent read-only state.
 */
export const readEmittingAgentId = (message: { metadata?: UIMessageMetadata }): string | null =>
  message.metadata?.emittingAgentId ?? null

/**
 * A live chat instance's message list — the entire surface
 * {@link applyEmittingAgentStamp} needs from `@ai-sdk/react`'s `Chat` class
 * (which exposes `messages` as a get/set pair).
 */
type LiveMessagesHost = { messages: ThunderboltUIMessage[] }

/**
 * Stamp `agentId` onto the just-finished assistant `message` and splice the
 * stamped copy back into `instance`'s live message list, so the Canvas
 * Action Channel gate (`./canvas-action-channel`) sees the stamp immediately
 * — not only after a reload. Returns the stamped message for the caller to
 * persist (`src/chats/chat-instance.ts`'s `onFinish`, the sole call site).
 *
 * Replacing the message in `finishedMessages` — rather than mutating
 * `message.metadata` in place — is what makes the stamp visible: `@ai-sdk/
 * react`'s own state-updating methods (e.g. `replaceMessage`) deep-clone on
 * every write they control, so an in-place mutation of a nested field is not
 * guaranteed to be picked up as a change by the rest of the app.
 *
 * `finishedMessages` is expected to already contain `message` (it is
 * `onFinish`'s own `messages` argument — the full history including the
 * just-finished message). If it doesn't — defensively, this should not
 * happen — the live array is left untouched, but the stamped message is
 * still returned so persistence isn't skipped.
 */
export const applyEmittingAgentStamp = (
  instance: LiveMessagesHost,
  finishedMessages: ThunderboltUIMessage[],
  message: ThunderboltUIMessage,
  agentId: string,
): ThunderboltUIMessage => {
  const stampedMessage: ThunderboltUIMessage = {
    ...message,
    metadata: stampEmittingAgent(message.metadata, agentId),
  }
  const index = finishedMessages.findIndex((m) => m.id === stampedMessage.id)
  if (index !== -1) {
    instance.messages = [...finishedMessages.slice(0, index), stampedMessage, ...finishedMessages.slice(index + 1)]
  }
  return stampedMessage
}
