/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import type { ThunderboltUIMessage } from '@/types'
import { applyEmittingAgentStamp, readEmittingAgentId, stampEmittingAgent } from './canvas-emitting-agent'

const msg = (id: string, metadata?: ThunderboltUIMessage['metadata']) =>
  ({ id, role: 'assistant', parts: [], metadata }) as ThunderboltUIMessage

describe('stampEmittingAgent', () => {
  it('sets emittingAgentId when metadata is undefined', () => {
    expect(stampEmittingAgent(undefined, 'a1')).toEqual({ emittingAgentId: 'a1' })
  })

  it('sets emittingAgentId when metadata exists but has no stamp yet', () => {
    expect(stampEmittingAgent({ modelId: 'm1' }, 'a1')).toEqual({ modelId: 'm1', emittingAgentId: 'a1' })
  })

  it('never overwrites an existing stamp — the historical emitter survives re-stamping', () => {
    const stamped = stampEmittingAgent(undefined, 'a1')
    expect(stampEmittingAgent(stamped, 'a2').emittingAgentId).toBe('a1')
  })
})

describe('readEmittingAgentId', () => {
  it('returns the stamped agent id', () => {
    expect(readEmittingAgentId({ metadata: { emittingAgentId: 'a1' } })).toBe('a1')
  })

  it('returns null when metadata is absent', () => {
    expect(readEmittingAgentId({})).toBeNull()
  })

  it('returns null when metadata exists but was never stamped (legacy message)', () => {
    expect(readEmittingAgentId({ metadata: { modelId: 'm1' } })).toBeNull()
  })
})

describe('applyEmittingAgentStamp', () => {
  it('stamps the message and splices it back into the live instance.messages by id', () => {
    const finishedMessages = [msg('u1'), msg('a1')]
    const instance = { messages: [] as ThunderboltUIMessage[] }
    const stamped = applyEmittingAgentStamp(instance, finishedMessages, msg('a1'), 'agent-1')

    expect(stamped.metadata?.emittingAgentId).toBe('agent-1')
    expect(instance.messages).toEqual([msg('u1'), stamped])
  })

  it('never overwrites an existing stamp', () => {
    const already = msg('a1', { emittingAgentId: 'agent-1' })
    const instance = { messages: [] as ThunderboltUIMessage[] }
    const stamped = applyEmittingAgentStamp(instance, [already], already, 'agent-2')

    expect(stamped.metadata?.emittingAgentId).toBe('agent-1')
  })

  it('still returns the stamped message when it is missing from finishedMessages, leaving the live array untouched', () => {
    const instance = { messages: [msg('other')] as ThunderboltUIMessage[] }
    const stamped = applyEmittingAgentStamp(instance, [msg('other')], msg('a1'), 'agent-1')

    expect(stamped.metadata?.emittingAgentId).toBe('agent-1')
    expect(instance.messages).toEqual([msg('other')])
  })
})
