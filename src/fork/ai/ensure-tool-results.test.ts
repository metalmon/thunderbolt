/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, test, expect } from 'bun:test'
import { streamText, MissingToolResultsError, type ModelMessage } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { ensureToolResults } from './ensure-tool-results'

const assistantCall = (id: string, name = 'do_thing'): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: name, input: { q: 'x' } }],
})
const toolResult = (id: string, name = 'do_thing'): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName: name, output: { type: 'text', value: 'ok' } }],
})
const user = (text: string): ModelMessage => ({ role: 'user', content: text })

const openIds = (messages: ModelMessage[]): string[] => {
  const open = new Set<string>()
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const p of m.content as any[]) if (p.type === 'tool-call') open.add(p.toolCallId)
    }
    if (m.role === 'tool') for (const p of m.content as any[]) if (p.type === 'tool-result') open.delete(p.toolCallId)
  }
  return [...open]
}

describe('ensureToolResults', () => {
  test('balanced input is unchanged', () => {
    const input: ModelMessage[] = [user('hi'), assistantCall('c1'), toolResult('c1'), user('next')]
    expect(ensureToolResults(input)).toEqual(input)
  })

  test('trailing unresolved tool-call at end → synthetic result appended', () => {
    const out = ensureToolResults([user('hi'), assistantCall('c1')])
    expect(openIds(out)).toEqual([])
    const last = out[out.length - 1]
    expect(last.role).toBe('tool')
    expect((last.content as any[])[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'c1',
      output: { type: 'error-text' },
    })
  })

  test('unresolved tool-call before a user message → synthetic result inserted before it', () => {
    const out = ensureToolResults([user('hi'), assistantCall('c1'), user('nudge')])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'user'])
    expect(openIds(out)).toEqual([])
  })

  test('partially resolved parallel calls → only the missing one is synthesized', () => {
    const a: ModelMessage = {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'c1', toolName: 't', input: {} },
        { type: 'tool-call', toolCallId: 'c2', toolName: 't', input: {} },
      ],
    }
    const out = ensureToolResults([user('hi'), a, toolResult('c1', 't'), user('x')])
    expect(openIds(out)).toEqual([])
    // c2 gets a synthetic error result
    const synthetic = out.flatMap((m) => (m.role === 'tool' ? (m.content as any[]) : [])).find((p) => p.toolCallId === 'c2')
    expect(synthetic.output.type).toBe('error-text')
  })

  test('provider-executed tool-calls are not treated as open', () => {
    const a: ModelMessage = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'p1', toolName: 'web', input: {}, providerExecuted: true } as any],
    }
    const out = ensureToolResults([user('hi'), a, user('x')])
    expect(out.some((m) => m.role === 'tool')).toBe(false)
  })

  test('REGRESSION: real streamText orphan + nudge throws, but not after ensureToolResults', async () => {
    // Faithfully reproduce the production trigger: attempt 1 emits a tool-call to
    // a tool with NO execute (mirrors an aborted / approval-gated tool), so
    // streamText's response.messages ends on an unresolved tool-call.
    const callingModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] })
            c.enqueue({ type: 'response-metadata', id: 'r1', modelId: 'mock', timestamp: new Date(0) })
            c.enqueue({ type: 'tool-input-start', id: 'call-8c175f00', toolName: 'do_thing' })
            c.enqueue({ type: 'tool-input-end', id: 'call-8c175f00' })
            c.enqueue({ type: 'tool-call', toolCallId: 'call-8c175f00', toolName: 'do_thing', input: JSON.stringify({ q: 'x' }) })
            c.enqueue({ type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as any)
            c.close()
          },
        }),
      }),
    })
    const attempt1 = streamText({
      model: callingModel,
      messages: [user('go')],
      maxRetries: 0,
      // Tool WITHOUT execute → SDK emits the call but produces no result.
      tools: { do_thing: { description: 'd', inputSchema: z.object({ q: z.string() }) } as any },
    })
    for await (const _ of attempt1.textStream) void _
    const response = await attempt1.response
    // Sanity: the response really is orphaned (tool-call, no tool-result).
    expect(response.messages.some((m) => m.role === 'tool')).toBe(false)

    // A model that streams a bit of text (so the only possible failure is the
    // standardization error, not "no output generated").
    const textModel = () =>
      new MockLanguageModelV3({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              c.enqueue({ type: 'text-start', id: 't1' })
              c.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' })
              c.enqueue({ type: 'text-end', id: 't1' })
              c.enqueue({ type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as any)
              c.close()
            },
          }),
        }),
      })

    // The fork retry loop appends a user nudge after response.messages.
    const retryPrompt: ModelMessage[] = [user('go'), ...(response.messages as ModelMessage[]), user('nudge')]

    // streamText routes the standardization failure to `onError` (exactly as
    // production fetch.ts observes it), not as a thrown/awaited rejection.
    const drain = async (messages: ModelMessage[]): Promise<unknown> => {
      let captured: unknown = null
      const r = streamText({
        model: textModel(),
        messages,
        maxRetries: 0,
        onError: ({ error }) => {
          captured = error
        },
      })
      for await (const _ of r.textStream) void _
      try {
        await r.response
      } catch {
        // response may reject when the stream errored; the error we assert on is
        // the one delivered to onError above.
      }
      return captured
    }

    // Baseline: unbalanced retry prompt → MissingToolResultsError on onError.
    expect(MissingToolResultsError.isInstance(await drain(retryPrompt))).toBe(true)

    // Fixed: normalized retry prompt → no error at all.
    expect(await drain(ensureToolResults(retryPrompt))).toBeNull()
  })
})
