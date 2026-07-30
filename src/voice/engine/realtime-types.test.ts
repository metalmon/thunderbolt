/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'bun:test'
import type { RealtimeEngine, RealtimeEvent, RealtimeToolCall } from './realtime-types'

describe('RealtimeEngine types', () => {
  it('should support RealtimeToolCall type', () => {
    const toolCall: RealtimeToolCall = { id: '1', name: 'submit_prompt', args: { prompt: 'x' } }
    expect(toolCall.id).toBe('1')
    expect(toolCall.name).toBe('submit_prompt')
  })

  it('should construct a RealtimeEngine with all methods and handle events', async () => {
    // Fake engine implementation for testing
    const fakeEngine = (): RealtimeEngine => {
      const eventQueue: RealtimeEvent[] = [
        { type: 'ready' },
        { type: 'tool_call', call: { id: '1', name: 'submit_prompt', args: { prompt: 'x' } } },
      ]

      return {
        id: 'test-engine',
        connect: async () => {
          // no-op for test
        },
        sendAudio: () => {
          // no-op for test
        },
        sendText: () => {
          // no-op for test
        },
        sendToolResponse: () => {
          // no-op for test
        },
        events: async function* () {
          for (const event of eventQueue) {
            yield event
          }
        },
        close: () => {
          // no-op for test
        },
      }
    }

    const e: RealtimeEngine = fakeEngine()

    // Consume events and verify type handling
    const events: RealtimeEvent[] = []
    for await (const event of e.events()) {
      events.push(event)
      if (events.length === 2) break
    }

    expect(events.length).toBe(2)
    expect(events[0]!.type).toBe('ready')
    expect(events[1]!.type).toBe('tool_call')

    // Verify type narrowing works for tool_call
    if (events[1]!.type === 'tool_call') {
      expect(events[1]!.call.id).toBe('1')
      expect(events[1]!.call.name).toBe('submit_prompt')
      expect(events[1]!.call.args.prompt).toBe('x')
    }
  })

  it('should handle all RealtimeEvent variants', async () => {
    const events: RealtimeEvent[] = [
      { type: 'ready' },
      { type: 'audio', pcm: new Float32Array(16) },
      { type: 'input_transcript', text: 'hello' },
      { type: 'output_transcript', text: 'hi there' },
      { type: 'interrupted' },
      { type: 'tool_call', call: { id: '1', name: 'test', args: {} } },
      { type: 'error', message: 'oops' },
      { type: 'closed' },
    ]

    for (const event of events) {
      switch (event.type) {
        case 'ready':
          expect(event.type).toBe('ready')
          break
        case 'audio':
          expect(event.pcm).toBeInstanceOf(Float32Array)
          break
        case 'input_transcript':
          expect(event.text).toBe('hello')
          break
        case 'output_transcript':
          expect(event.text).toBe('hi there')
          break
        case 'interrupted':
          expect(event.type).toBe('interrupted')
          break
        case 'tool_call':
          expect(event.call.name).toBe('test')
          break
        case 'error':
          expect(event.message).toBe('oops')
          break
        case 'closed':
          expect(event.type).toBe('closed')
          break
      }
    }
  })
})
