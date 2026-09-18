/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import { filterMessageParts, groupMessageParts, type ReasoningGroupUIPart } from '@/lib/assistant-message'
import type { ThunderboltUIMessage } from '@/types'
import type { CanvasActionMeta } from './canvas-action-message'
import { planCanvasStepGroups } from './canvas-step-grouping'

const toolOnly: CanvasActionMeta = { toolCall: { name: 'search' }, uri: 'ui://d', callId: 'n:1' }
const promptAction: CanvasActionMeta = { prompt: 'Do it', uri: 'ui://d', callId: 'n:2' }

/** A hidden canvas tool-only user turn (the send that triggers a silent dispatch). */
const hiddenUser = (id: string): ThunderboltUIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text: '' }], metadata: { canvasAction: toolOnly } }) as never

/** An assistant reply that renders as a single "Completed 1 step" accordion (one tool part). */
const stepTurn = (id: string, toolCallId: string, reasoningMs: number): ThunderboltUIMessage =>
  ({
    id,
    role: 'assistant',
    parts: [{ type: 'tool-search', toolCallId, state: 'output-available', input: {}, output: { results: [] } }],
    metadata: { reasoningTime: { [toolCallId]: reasoningMs } },
  }) as never

const textTurn = (id: string, text: string): ThunderboltUIMessage =>
  ({ id, role: 'assistant', parts: [{ type: 'text', text }], metadata: {} }) as never

const plainUser = (id: string, text: string): ThunderboltUIMessage =>
  ({ id, role: 'user', parts: [{ type: 'text', text }], metadata: {} }) as never

/** Reproduce ReasoningGroup's rendered shape from a message's parts. */
const soleReasoningGroup = (message: ThunderboltUIMessage): ReasoningGroupUIPart => {
  const grouped = groupMessageParts(filterMessageParts(message.parts))
  expect(grouped).toHaveLength(1)
  expect(grouped[0].type).toBe('reasoning_group')
  return grouped[0] as ReasoningGroupUIPart
}

describe('planCanvasStepGroups', () => {
  it('merges a run of ≥2 consecutive tool-only canvas accordions into one', () => {
    const messages = [
      hiddenUser('u1'),
      stepTurn('a1', 'call_1', 19),
      hiddenUser('u2'),
      stepTurn('a2', 'call_2', 18),
      hiddenUser('u3'),
      stepTurn('a3', 'call_3', 22),
    ]
    const { merged, absorbed, dispatchTailHeadId } = planCanvasStepGroups(messages)

    // Head (first member) carries the merged message; the rest are absorbed (render nothing).
    expect([...absorbed]).toEqual(['a2', 'a3'])
    expect(merged.has('a1')).toBe(true)
    expect(merged.has('a2')).toBe(false)
    // The run sits at the tail → its head is the accordion to spin while active.
    expect(dispatchTailHeadId).toBe('a1')

    const head = merged.get('a1') as ThunderboltUIMessage
    // One accordion, three tool steps, summed duration.
    const group = soleReasoningGroup(head)
    const tools = group.items.filter((item) => item.type === 'tool')
    expect(tools).toHaveLength(3)
    expect(head.metadata?.reasoningTime).toEqual({ call_1: 19, call_2: 18, call_3: 22 })
  })

  it('leaves a single tool-only accordion untouched (run length 1) but marks it as the tail spinner', () => {
    const messages = [hiddenUser('u1'), stepTurn('a1', 'call_1', 19)]
    const { merged, absorbed, dispatchTailHeadId } = planCanvasStepGroups(messages)
    expect(merged.size).toBe(0)
    expect(absorbed.size).toBe(0)
    // A lone dispatch still owns the tail spinner — it spins on its own accordion.
    expect(dispatchTailHeadId).toBe('a1')
  })

  it('marks the tail accordion during the submitted gap (trailing hidden send, reply pending)', () => {
    // Second click sent (u2 hidden) but its reply has not arrived yet.
    const messages = [hiddenUser('u1'), stepTurn('a1', 'call_1', 19), hiddenUser('u2')]
    const { dispatchTailHeadId } = planCanvasStepGroups(messages)
    expect(dispatchTailHeadId).toBe('a1')
  })

  it('does not mark a tail spinner when the last turn is a normal answer', () => {
    const messages = [
      hiddenUser('u1'),
      stepTurn('a1', 'call_1', 19),
      hiddenUser('u2'),
      stepTurn('a2', 'call_2', 18),
      plainUser('u3', 'hi'),
      textTurn('a3', 'later answer'),
    ]
    const { merged, dispatchTailHeadId } = planCanvasStepGroups(messages)
    expect(merged.has('a1')).toBe(true)
    expect(dispatchTailHeadId).toBeUndefined()
  })

  it('a text-bearing (narration) reply breaks the run — its text is never folded away', () => {
    const messages = [
      hiddenUser('u1'),
      stepTurn('a1', 'call_1', 19),
      hiddenUser('u2'),
      textTurn('a2', 'Нашёлся один HTML-файл.'),
      hiddenUser('u3'),
      stepTurn('a3', 'call_3', 22),
    ]
    const { merged, absorbed } = planCanvasStepGroups(messages)
    // a1 alone, a2 is a real bubble, a3 alone — nothing merges.
    expect(merged.size).toBe(0)
    expect(absorbed.size).toBe(0)
  })

  it('merges the leading run and stops at the narration that breaks it', () => {
    const messages = [
      hiddenUser('u1'),
      stepTurn('a1', 'call_1', 10),
      hiddenUser('u2'),
      stepTurn('a2', 'call_2', 10),
      hiddenUser('u3'),
      textTurn('a3', 'answer'),
    ]
    const { merged, absorbed } = planCanvasStepGroups(messages)
    expect(merged.has('a1')).toBe(true)
    expect([...absorbed]).toEqual(['a2'])
  })

  it('does not merge normal (non-canvas) tool turns — prev is a plain user message', () => {
    const messages = [
      plainUser('u1', 'search please'),
      stepTurn('a1', 'call_1', 19),
      plainUser('u2', 'again'),
      stepTurn('a2', 'call_2', 18),
    ]
    const { merged, absorbed } = planCanvasStepGroups(messages)
    expect(merged.size).toBe(0)
    expect(absorbed.size).toBe(0)
  })

  it('folds an in-flight (0-part) trailing dispatch into the run instead of rendering it standalone', () => {
    // The just-clicked dispatch has no parts yet (in-flight). It must be absorbed
    // immediately — never rendered as its own accordion that later collapses.
    const inflight: ThunderboltUIMessage = { id: 'a2', role: 'assistant', parts: [], metadata: {} } as never
    const messages = [hiddenUser('u1'), stepTurn('a1', 'call_1', 19), hiddenUser('u2'), inflight]
    const { merged, absorbed, dispatchTailHeadId } = planCanvasStepGroups(messages)

    expect([...absorbed]).toEqual(['a2'])
    expect(merged.has('a1')).toBe(true)
    expect(dispatchTailHeadId).toBe('a1')
    // Only a1's tool so far; a2 contributes nothing until it streams.
    const head = merged.get('a1') as ThunderboltUIMessage
    expect(soleReasoningGroup(head).items.filter((item) => item.type === 'tool')).toHaveLength(1)
  })

  it('is display-only: never mutates the input messages or their parts', () => {
    const messages = [hiddenUser('u1'), stepTurn('a1', 'call_1', 19), hiddenUser('u2'), stepTurn('a2', 'call_2', 18)]
    const before = JSON.stringify(messages)
    const originalParts = messages.map((m) => m.parts)

    const { merged } = planCanvasStepGroups(messages)

    // Input untouched, part arrays are the same references (not reused for the merge).
    expect(JSON.stringify(messages)).toBe(before)
    messages.forEach((m, i) => expect(m.parts).toBe(originalParts[i]))
    const head = merged.get('a1') as ThunderboltUIMessage
    expect(head.parts).not.toBe(messages[1].parts)
  })

  it('does not fold a prompt-bearing canvas turn (visible, attributed bubble)', () => {
    const promptUser: ThunderboltUIMessage = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'Do it' }],
      metadata: { canvasAction: promptAction },
    } as never
    const messages = [promptUser, stepTurn('a1', 'call_1', 19), hiddenUser('u2'), stepTurn('a2', 'call_2', 18)]
    const { merged, absorbed } = planCanvasStepGroups(messages)
    // a1's prev is a prompt-bearing (visible) canvas turn, not a hidden one → not a run member.
    expect(merged.size).toBe(0)
    expect(absorbed.size).toBe(0)
  })
})
