/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Canvas Action Channel — consecutive tool-only dispatch grouping (render-only).
 *
 * A tool-only canvas control (a `ui://` artifact button that fires a tool with
 * no user-visible prompt) produces one ACP turn per click: a hidden user turn
 * ({@link isHiddenCanvasTurn}) plus an assistant turn whose only rendered
 * content is the tool result — shown as a single "Completed 1 step"
 * reasoning-group accordion. Clicking such a control several times stacks N
 * separate accordions and stretches the transcript.
 *
 * This module coalesces a run of ≥2 consecutive such accordions into ONE
 * synthetic assistant message, for DISPLAY ONLY. It never mutates the message
 * array and never calls `setMessages`, so the history the ACP layer sends to
 * the model is byte-for-byte unchanged — the N turns remain N records on the
 * wire; only their on-screen rendering is merged. The merged `parts` flow
 * through the same `filterMessageParts` → `groupMessageParts` → `ReasoningGroup`
 * pipeline, so the run renders as one "Completed N steps in <sum>ms" accordion
 * listing every call, with the per-call durations summed.
 *
 * A streaming / in-flight dispatch is folded into its run from the moment it
 * appears (an empty in-flight turn is foldable), so it never renders as a
 * separate accordion that later collapses — the head accordion simply grows its
 * step count in place. `dispatchTailHeadId` names the accordion at the tail of
 * the conversation: while a dispatch is active the caller shows a spinner on
 * THAT accordion (in place of its check) and suppresses the separate bottom
 * loading indicator, so the spinner lives on the accordion and the layout never
 * shifts. The head is never given the last-message viewport reserve (~72dvh),
 * which would make it jump. A reply that carries model narration (a non-empty
 * text part) is NOT foldable — it renders as its own bubble and breaks the run,
 * so no visible text is ever hidden inside an accordion.
 */

import { filterMessageParts, groupMessageParts } from '@/lib/assistant-message'
import type { ThunderboltUIMessage, UIMessageMetadata } from '@/types'
import { isHiddenCanvasAssistantTurn, isHiddenCanvasTurn } from './canvas-action-message'

/** The render-time plan produced from a message list. */
export type CanvasStepGrouping = {
  /** Ids of run members after the head — they render nothing (absorbed into the head's accordion). */
  absorbed: Set<string>
  /** Run-head message id → the synthetic merged message to render in its place. */
  merged: Map<string, ThunderboltUIMessage>
  /**
   * The accordion at the tail of the conversation, when the last non-transparent
   * message is a canvas dispatch reply — the merged run head, or a lone dispatch's
   * own id. The caller spins this accordion (and hides the bottom loader) while a
   * dispatch is active. `undefined` when the tail is not a canvas dispatch.
   */
  dispatchTailHeadId?: string
}

/**
 * An assistant reply to a hidden tool-only canvas send. Identity is stable
 * across streaming (it depends only on the preceding hidden send, not on how
 * far the reply has streamed), which is what lets an in-flight dispatch join
 * its run immediately instead of flickering in as a standalone accordion. A
 * normal agent tool turn (whose prev is a real user message) never qualifies.
 */
const isCanvasDispatchTurn = (messages: ThunderboltUIMessage[], index: number): boolean => {
  const message = messages[index]
  if (message.role !== 'assistant') {
    return false
  }
  const prev = messages[index - 1]
  return !!prev && isHiddenCanvasTurn(prev)
}

/**
 * Whether a dispatch reply is foldable into an accordion: no narration text and
 * no lifted-out card (artifact / `ui://` resource / delivered-file). An empty
 * in-flight turn is foldable too, so it is absorbed while it streams rather than
 * rendered separately.
 */
const isFoldableStepTurn = (message: ThunderboltUIMessage): boolean => {
  const filtered = filterMessageParts(message.parts)
  if (filtered.some((part) => part.type === 'text')) {
    return false
  }
  const grouped = groupMessageParts(filtered)
  return grouped.length === 0 || (grouped.length === 1 && grouped[0].type === 'reasoning_group')
}

const isMergeable = (messages: ThunderboltUIMessage[], index: number): boolean =>
  isCanvasDispatchTurn(messages, index) && isFoldableStepTurn(messages[index])

/** Index of the previous message that renders (skipping transparent ones). */
const prevRenderedIndex = (messages: ThunderboltUIMessage[], from: number): number => {
  let p = from - 1
  while (p >= 0 && isTransparent(messages[p])) {
    p--
  }
  return p
}

/**
 * The head accordion of the canvas-dispatch run at the tail of the conversation,
 * or undefined when the last rendered message is not a dispatch. Walks past any
 * trailing transparent messages (e.g. a pending hidden send awaiting its reply)
 * so the accordion still spins during the `submitted` gap before the reply exists.
 */
const tailDispatchHeadId = (messages: ThunderboltUIMessage[]): string | undefined => {
  let k = messages.length - 1
  while (k >= 0 && isTransparent(messages[k])) {
    k--
  }
  if (k < 0 || !isMergeable(messages, k)) {
    return undefined
  }
  let head = k
  for (
    let p = prevRenderedIndex(messages, head);
    p >= 0 && isMergeable(messages, p);
    p = prevRenderedIndex(messages, head)
  ) {
    head = p
  }
  return messages[head].id
}

/** Messages that render nothing and so may sit between two run members without breaking the run. */
const isTransparent = (message: ThunderboltUIMessage): boolean =>
  isHiddenCanvasTurn(message) || message.metadata?.oauthRetry === true || isHiddenCanvasAssistantTurn(message)

/** Shallow-merge a set of optional records, or undefined when none are present. */
const mergeRecords = <T>(maps: (Record<string, T> | undefined)[]): Record<string, T> | undefined => {
  const present = maps.filter((map): map is Record<string, T> => map != null)
  return present.length === 0 ? undefined : Object.assign({}, ...present)
}

/**
 * Build the synthetic display message for a run: the head's identity, every
 * member's parts concatenated, and the duration/tool-label metadata merged so
 * the single accordion sums the per-call times and resolves every tool's label.
 */
const buildMergedStepMessage = (runMessages: ThunderboltUIMessage[]): ThunderboltUIMessage => {
  const head = runMessages[0]
  const reasoningTime = mergeRecords(runMessages.map((message) => message.metadata?.reasoningTime))
  const reasoningStartTimes = mergeRecords(runMessages.map((message) => message.metadata?.reasoningStartTimes))
  const mcpTools = mergeRecords<NonNullable<UIMessageMetadata['mcpTools']>[string]>(
    runMessages.map((message) => message.metadata?.mcpTools),
  )
  return {
    ...head,
    parts: runMessages.flatMap((message) => message.parts),
    metadata: {
      ...head.metadata,
      ...(reasoningTime ? { reasoningTime } : {}),
      ...(reasoningStartTimes ? { reasoningStartTimes } : {}),
      ...(mcpTools ? { mcpTools } : {}),
    },
  }
}

/**
 * Plan the display-only grouping for a message list. A run is a maximal chain
 * of mergeable dispatch turns whose only interleaving messages are transparent
 * (the hidden canvas user sends between clicks). Runs of length ≥2 collapse to
 * one synthetic message on the head; runs of length 1 are left as-is.
 *
 * @param messages - the live message list (never mutated)
 */
export const planCanvasStepGroups = (messages: ThunderboltUIMessage[]): CanvasStepGrouping => {
  const absorbed = new Set<string>()
  const merged = new Map<string, ThunderboltUIMessage>()

  let i = 0
  while (i < messages.length) {
    if (!isMergeable(messages, i)) {
      i++
      continue
    }

    const run = [i]
    let cursor = i + 1
    while (cursor < messages.length) {
      let next = cursor
      while (next < messages.length && isTransparent(messages[next])) {
        next++
      }
      if (next < messages.length && isMergeable(messages, next)) {
        run.push(next)
        cursor = next + 1
      } else {
        break
      }
    }

    if (run.length >= 2) {
      const runMessages = run.map((index) => messages[index])
      merged.set(runMessages[0].id, buildMergedStepMessage(runMessages))
      for (let r = 1; r < run.length; r++) {
        absorbed.add(messages[run[r]].id)
      }
    }
    i = cursor
  }

  return { absorbed, merged, dispatchTailHeadId: tailDispatchHeadId(messages) }
}
