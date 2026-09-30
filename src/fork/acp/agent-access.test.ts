/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it, mock } from 'bun:test'
import { isAgentNotPermitted, probeAgentAccess } from './agent-access'

/** The shape the runtime actually answers with, as observed against the pilot. */
const denial = Object.assign(new Error('Agent `payroll-bot` is not permitted for this principal'), {
  code: -32602,
  data: { reason: 'agent_not_permitted' },
})

describe('isAgentNotPermitted', () => {
  it('recognises the refusal by its reason', () => {
    expect(isAgentNotPermitted(denial)).toBe(true)
  })

  it('recognises it by message alone, for transports that drop `data`', () => {
    expect(isAgentNotPermitted(new Error('Agent `payroll-bot` is not permitted for this principal'))).toBe(true)
  })

  it('does not mistake other failures for a refusal', () => {
    expect(isAgentNotPermitted(new Error('Connection timed out'))).toBe(false)
    expect(isAgentNotPermitted({ code: -32601, message: 'Method not found' })).toBe(false)
    expect(isAgentNotPermitted(null)).toBe(false)
    expect(isAgentNotPermitted('nope')).toBe(false)
  })
})

describe('probeAgentAccess', () => {
  it('mints a session, closes it, and reports access', async () => {
    const closeSession = mock(async () => ({}))
    const newSession = mock(async () => ({ sessionId: 'sess-1' }))

    expect(await probeAgentAccess({ newSession, closeSession })).toBe('permitted')
    expect(newSession).toHaveBeenCalledWith({ cwd: '.', mcpServers: [] })
    // session/close frees the slot; session/cancel would only end the turn and
    // leave the session counting against the runtime's max_sessions cap.
    expect(closeSession).toHaveBeenCalledWith({ sessionId: 'sess-1' })
  })

  it('reports a denial when the agent is not permitted for this account', async () => {
    const newSession = mock(async () => {
      throw denial
    })

    expect(await probeAgentAccess({ newSession })).toBe('denied')
  })

  it('stays silent about failures it cannot attribute to permissions', async () => {
    // initialize already succeeded, so an unrelated session/new failure says
    // nothing about access — inventing one would fail a working agent.
    const newSession = mock(async () => {
      throw new Error('Internal error')
    })

    expect(await probeAgentAccess({ newSession })).toBe('unknown')
  })

  it('stays silent for an agent that does not implement session/new', async () => {
    expect(await probeAgentAccess({})).toBe('unknown')
  })

  it('still reports access when closing the throwaway session fails', async () => {
    const newSession = mock(async () => ({ sessionId: 'sess-1' }))
    const closeSession = mock(async () => {
      throw new Error('already gone')
    })

    expect(await probeAgentAccess({ newSession, closeSession })).toBe('permitted')
  })
})
