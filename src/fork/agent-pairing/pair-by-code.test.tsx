/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'

import { getAgentSecrets } from '@/dal'
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '@/dal/test-utils'
import { getDb } from '@/db/database'
import { createTestProvider } from '@/test-utils/test-provider'
import { PairByCode } from './pair-by-code'
import { PairingError } from './pair-over-acp'

const AGENT_ID = 'agent-1'
const AGENT_URL = 'wss://gw.example/acp'

describe('PairByCode', () => {
  beforeAll(async () => {
    await setupTestDatabase()
  })
  afterAll(async () => {
    await teardownTestDatabase()
  })
  afterEach(async () => {
    cleanup()
    await resetTestDatabase()
  })

  it('renders nothing without an agent URL', () => {
    render(<PairByCode agentId={AGENT_ID} agentUrl={null} />, { wrapper: createTestProvider() })
    expect(screen.queryByLabelText('Connection code')).not.toBeInTheDocument()
  })

  it('exchanges the trimmed code and stores the issued token in the shared secret slot', async () => {
    const pair = mock(async () => ({ token: 'zc_paired' }))
    render(<PairByCode agentId={AGENT_ID} agentUrl={AGENT_URL} pair={pair} />, { wrapper: createTestProvider() })

    fireEvent.change(screen.getByLabelText('Connection code'), { target: { value: '  ABC123  ' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pair' }))
    })

    expect(pair).toHaveBeenCalledWith({ url: AGENT_URL, code: 'ABC123' })
    expect(await getAgentSecrets(getDb(), AGENT_ID)).toEqual({ apiKey: 'zc_paired', authMethod: 'bearer' })
  })

  it('shows a typed error and writes nothing on a bad code', async () => {
    const pair = mock(async () => {
      throw new PairingError('invalid_code', 'bad code')
    })
    render(<PairByCode agentId={AGENT_ID} agentUrl={AGENT_URL} pair={pair} />, { wrapper: createTestProvider() })

    fireEvent.change(screen.getByLabelText('Connection code'), { target: { value: 'BAD' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pair' }))
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect((await getAgentSecrets(getDb(), AGENT_ID))?.apiKey ?? null).toBeNull()
  })

  it('disables Pair for an empty code', () => {
    const pair = mock(async () => ({ token: 'zc_x' }))
    render(<PairByCode agentId={AGENT_ID} agentUrl={AGENT_URL} pair={pair} />, { wrapper: createTestProvider() })
    expect(screen.getByRole('button', { name: 'Pair' })).toBeDisabled()
    expect(pair).not.toHaveBeenCalled()
  })
})
