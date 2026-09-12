/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import type { ThunderboltUIMessage } from '@/types'
import { CANVAS_META_KEY } from './canvas-negotiation'
import {
  buildCanvasActionMessage,
  buildCanvasWireMeta,
  getCanvasAction,
  isCanvasOriginTurn,
  isHiddenCanvasAssistantTurn,
  isHiddenCanvasTurn,
  SYNTHETIC_TOOL_DIRECTIVE,
  type CanvasActionMeta,
} from './canvas-action-message'

const toolOnlyAction: CanvasActionMeta = {
  toolCall: { name: 'x', arguments: { a: 1 } },
  uri: 'ui://d',
  callId: 'n:1',
}

const promptAction: CanvasActionMeta = {
  prompt: 'Do the thing',
  uri: 'ui://d',
  callId: 'n:2',
}

describe('canvas-action-message', () => {
  it('uses the synthetic directive for a tool-only action', () => {
    const message = buildCanvasActionMessage(toolOnlyAction)
    expect(message.parts).toEqual([{ type: 'text', text: SYNTHETIC_TOOL_DIRECTIVE }])
  })

  it('uses the prompt as the text when present', () => {
    const message = buildCanvasActionMessage(promptAction)
    expect(message.parts).toEqual([{ type: 'text', text: 'Do the thing' }])
  })

  it('round-trips metadata.canvasAction through getCanvasAction', () => {
    const message = buildCanvasActionMessage(toolOnlyAction)
    expect(getCanvasAction(message)).toEqual(toolOnlyAction)
  })

  it('round-trips a prompt-bearing action', () => {
    const message = buildCanvasActionMessage(promptAction)
    expect(getCanvasAction(message)).toEqual(promptAction)
  })

  it('nests the wire meta under CANVAS_META_KEY with toolCall/uri/callId', () => {
    expect(buildCanvasWireMeta(toolOnlyAction)).toEqual({
      [CANVAS_META_KEY]: { toolCall: toolOnlyAction.toolCall, uri: toolOnlyAction.uri, callId: toolOnlyAction.callId },
    })
  })

  it('nests the wire meta under CANVAS_META_KEY with prompt/uri/callId', () => {
    expect(buildCanvasWireMeta(promptAction)).toEqual({
      [CANVAS_META_KEY]: { prompt: promptAction.prompt, uri: promptAction.uri, callId: promptAction.callId },
    })
  })

  it('omits toolCall/prompt keys entirely when absent, rather than nulling them', () => {
    const wireMeta = buildCanvasWireMeta(promptAction)[CANVAS_META_KEY] as Record<string, unknown>
    expect('toolCall' in wireMeta).toBe(false)
  })

  it('isHiddenCanvasTurn is true for tool-only, false for prompt-bearing', () => {
    expect(isHiddenCanvasTurn(buildCanvasActionMessage(toolOnlyAction))).toBe(true)
    expect(isHiddenCanvasTurn(buildCanvasActionMessage(promptAction))).toBe(false)
  })

  it('isCanvasOriginTurn is the inverse for canvas turns', () => {
    expect(isCanvasOriginTurn(buildCanvasActionMessage(toolOnlyAction))).toBe(false)
    expect(isCanvasOriginTurn(buildCanvasActionMessage(promptAction))).toBe(true)
  })

  it('a plain message has no canvas action and both predicates are false', () => {
    const plain = { parts: [{ type: 'text' as const, text: 'hi' }], metadata: undefined }
    expect(getCanvasAction(plain)).toBeNull()
    expect(isHiddenCanvasTurn(plain)).toBe(false)
    expect(isCanvasOriginTurn(plain)).toBe(false)
  })
})

describe('isHiddenCanvasAssistantTurn', () => {
  const canvasToolPart = {
    type: 'tool-runCanvasAction',
    toolCallId: 'canvas:nonce1:app-call-1',
    state: 'output-available' as const,
    input: {},
    output: { ok: true },
  }

  const normalToolPart = {
    type: 'tool-search',
    toolCallId: 'call_abc123',
    state: 'output-available' as const,
    input: {},
    output: { results: [] },
  }

  const uiResourceToolPart = {
    type: 'tool-renderHtml',
    toolCallId: 'call_render1',
    state: 'output-available' as const,
    input: {},
    output: { uiResource: { uri: 'ui://d/1', mimeType: 'text/html', html: '<div/>' } },
  }

  const asMessage = (
    role: ThunderboltUIMessage['role'],
    parts: unknown[],
  ): Pick<ThunderboltUIMessage, 'role' | 'parts'> => ({ role, parts }) as never

  it('is true for a tool-only canvas action reply: only a canvas: tool part, no text', () => {
    expect(isHiddenCanvasAssistantTurn(asMessage('assistant', [canvasToolPart]))).toBe(true)
  })

  it('is false when the assistant turn also carries text (combined mode / ui/prompt answer)', () => {
    expect(
      isHiddenCanvasAssistantTurn(
        asMessage('assistant', [{ type: 'text', text: 'Here is the answer' }, canvasToolPart]),
      ),
    ).toBe(false)
  })

  it('is false for a normal (non-canvas) tool call', () => {
    expect(isHiddenCanvasAssistantTurn(asMessage('assistant', [normalToolPart]))).toBe(false)
  })

  it('is false when the turn emits a ui:// resource part, even with no text', () => {
    expect(isHiddenCanvasAssistantTurn(asMessage('assistant', [uiResourceToolPart]))).toBe(false)
  })

  it('is false for a plain text-only assistant turn', () => {
    expect(isHiddenCanvasAssistantTurn(asMessage('assistant', [{ type: 'text', text: 'Hello' }]))).toBe(false)
  })

  it('is false for a user message, even with a canvas: tool part shape', () => {
    expect(isHiddenCanvasAssistantTurn(asMessage('user', [canvasToolPart]))).toBe(false)
  })

  it('is false for an empty-parts assistant turn (in-flight placeholder)', () => {
    expect(isHiddenCanvasAssistantTurn(asMessage('assistant', []))).toBe(false)
  })

  it('is false for a reasoning-only assistant turn', () => {
    expect(
      isHiddenCanvasAssistantTurn(asMessage('assistant', [{ type: 'reasoning', text: 'thinking...', state: 'done' }])),
    ).toBe(false)
  })

  it('is true with multiple canvas: tool parts and no text', () => {
    const secondCanvasToolPart = { ...canvasToolPart, toolCallId: 'canvas:nonce1:app-call-2' }
    expect(isHiddenCanvasAssistantTurn(asMessage('assistant', [canvasToolPart, secondCanvasToolPart]))).toBe(true)
  })

  it('is false when one of several tool parts is not canvas-origin', () => {
    expect(isHiddenCanvasAssistantTurn(asMessage('assistant', [canvasToolPart, normalToolPart]))).toBe(false)
  })
})
