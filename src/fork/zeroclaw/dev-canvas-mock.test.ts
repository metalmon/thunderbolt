/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import { renderHtmlOutput, type RenderHtmlPart } from '@/artifacts/render-html-tool'
import { composeCanvasCallId, CANVAS_TOOLCALL_PREFIX } from './canvas-call-id'
import { buildMockCanvasResultMessage, findUnresolvedCanvasActions } from './dev-canvas-mock'
import type { CanvasActionMeta } from './canvas-action-message'
import type { ThunderboltUIMessage } from '@/types'

const userMsg = (id: string, action: CanvasActionMeta) =>
  ({ id, role: 'user', parts: [{ type: 'text', text: 'x' }], metadata: { canvasAction: action } }) as never

const assistantMsg = (id: string, parts: unknown[]) => ({ id, role: 'assistant', parts }) as never

const toolAction: CanvasActionMeta = {
  toolCall: { name: 'mock_tool', arguments: { a: 1 } },
  uri: 'ui://dev/demo',
  callId: composeCanvasCallId('nonce-1', 'app-1'),
}

const promptOnlyAction: CanvasActionMeta = {
  prompt: 'Explain this',
  uri: 'ui://dev/demo',
  callId: composeCanvasCallId('nonce-1', 'prompt-1'),
}

describe('buildMockCanvasResultMessage', () => {
  it('builds an output-available tool part whose toolCallId is canvas:<callId>', () => {
    const message = buildMockCanvasResultMessage(toolAction)
    expect(message.role).toBe('assistant')
    const part = message.parts[0] as unknown as { type: string; toolCallId: string; state: string; output: unknown }
    expect(part.toolCallId).toBe(`${CANVAS_TOOLCALL_PREFIX}${toolAction.callId}`)
    expect(part.state).toBe('output-available')
    expect(part.output).toEqual({ success: true, tool: 'mock_tool', echo: { a: 1 } })
  })

  it('types the part tool-<name> after the requested tool, falling back to tool-canvas', () => {
    const named = buildMockCanvasResultMessage(toolAction)
    expect((named.parts[0] as unknown as { type: string }).type).toBe('tool-mock_tool')

    const noNameAction: CanvasActionMeta = { uri: 'ui://dev/demo', callId: composeCanvasCallId('n', 'a2') }
    const fallback = buildMockCanvasResultMessage(noNameAction)
    expect((fallback.parts[0] as unknown as { type: string }).type).toBe('tool-canvas')
  })

  it('regression: the output shape never satisfies the render_html artifact-card gate, even if the requested tool is literally named render_html', () => {
    const renderHtmlAction: CanvasActionMeta = {
      toolCall: { name: 'render_html', arguments: {} },
      uri: 'ui://dev/demo',
      callId: composeCanvasCallId('n', 'a3'),
    }
    const message = buildMockCanvasResultMessage(renderHtmlAction)
    const part = message.parts[0] as unknown as RenderHtmlPart
    // isRenderHtmlPart would recognize this part (type is `tool-render_html`), so the ONLY thing
    // standing between it and a false blank artifact card is renderHtmlOutput(part)?.ok !== true.
    expect(renderHtmlOutput(part)?.ok).not.toBe(true)
  })
})

describe('findUnresolvedCanvasActions', () => {
  it('finds a tool-call action with no matching tool part yet', () => {
    const messages = [userMsg('m1', toolAction)] as unknown as ThunderboltUIMessage[]
    expect(findUnresolvedCanvasActions(messages)).toEqual([{ messageId: 'm1', action: toolAction }])
  })

  it('ignores an action once a matching tool part (real or synthetic) exists', () => {
    const toolCallId = `${CANVAS_TOOLCALL_PREFIX}${toolAction.callId}`
    const messages = [
      userMsg('m1', toolAction),
      assistantMsg('m2', [{ type: 'tool-canvas', toolCallId, state: 'output-available', output: {} }]),
    ] as unknown as ThunderboltUIMessage[]
    expect(findUnresolvedCanvasActions(messages)).toEqual([])
  })

  it('ignores a prompt-only action (ui/prompt has no pending call to mock)', () => {
    const messages = [userMsg('m1', promptOnlyAction)] as unknown as ThunderboltUIMessage[]
    expect(findUnresolvedCanvasActions(messages)).toEqual([])
  })

  it('ignores non-canvas and non-user messages', () => {
    const messages = [
      assistantMsg('m1', [{ type: 'text', text: 'hi' }]),
      { id: 'm2', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ] as unknown as ThunderboltUIMessage[]
    expect(findUnresolvedCanvasActions(messages)).toEqual([])
  })
})
