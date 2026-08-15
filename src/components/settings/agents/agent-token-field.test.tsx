/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { getAgentSecrets, setAgentBearerToken } from '@/dal'
import { resetTestDatabase, setupTestDatabase, teardownTestDatabase } from '@/dal/test-utils'
import { getDb } from '@/db/database'
import { createTestProvider } from '@/test-utils/test-provider'
import { renderWithReactivity, waitForElement } from '@/test-utils/powersync-reactivity-test'
import { getClock } from '@/testing-library'
import { AgentTokenField } from './agent-token-field'

const AGENT_ID = 'agent-1'

describe('AgentTokenField', () => {
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

  it('shows the empty placeholder and no Clear affordance when no token is stored', () => {
    render(<AgentTokenField agentId={AGENT_ID} />, { wrapper: createTestProvider() })

    expect(screen.getByPlaceholderText('Paste the agent access token')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove token' })).not.toBeInTheDocument()
  })

  it('shows the populated indicator and a Clear affordance when a bearer token is stored, never the raw value', async () => {
    const db = getDb()
    await setAgentBearerToken(db, AGENT_ID, 'super-secret-token')

    render(<AgentTokenField agentId={AGENT_ID} />, { wrapper: createTestProvider() })

    expect(await screen.findByPlaceholderText('Token set')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove token' })).toBeInTheDocument()
    expect(screen.queryByDisplayValue('super-secret-token')).not.toBeInTheDocument()
    expect(screen.queryByText('super-secret-token')).not.toBeInTheDocument()
  })

  it('saves a typed draft as the bearer token', async () => {
    const db = getDb()
    render(<AgentTokenField agentId={AGENT_ID} />, { wrapper: createTestProvider() })

    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'new-token-value' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })

    const secret = await getAgentSecrets(db, AGENT_ID)
    expect(secret).toEqual({ apiKey: 'new-token-value', authMethod: 'bearer' })
  })

  it('clears the stored token', async () => {
    const db = getDb()
    await setAgentBearerToken(db, AGENT_ID, 'super-secret-token')

    render(<AgentTokenField agentId={AGENT_ID} />, { wrapper: createTestProvider() })

    const clearButton = await screen.findByRole('button', { name: 'Remove token' })
    await act(async () => {
      fireEvent.click(clearButton)
    })

    const secret = await getAgentSecrets(db, AGENT_ID)
    expect(secret).toEqual({ apiKey: null, authMethod: null })
  })
})

describe('AgentTokenField — reactivity', () => {
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

  it('flips to the populated indicator in place when the row changes and PowerSync notifies', async () => {
    const { triggerChange } = renderWithReactivity(<AgentTokenField agentId={AGENT_ID} />, {
      tables: ['agents_secrets'],
    })
    // Let the hook's async resolveTables()-then-subscribe effect chain settle
    // before triggering a change, or the PowerSync mock has no subscription yet.
    await act(async () => {
      await getClock().runAllAsync()
    })

    expect(screen.queryByRole('button', { name: 'Remove token' })).not.toBeInTheDocument()

    await setAgentBearerToken(getDb(), AGENT_ID, 'externally-written-token')
    await act(async () => {
      triggerChange(['agents_secrets'])
      await getClock().runAllAsync()
    })

    expect(screen.getByRole('button', { name: 'Remove token' })).toBeInTheDocument()
  })

  it('shows the populated indicator in the same mounted field right after clicking Save', async () => {
    renderWithReactivity(<AgentTokenField agentId={AGENT_ID} />, { tables: ['agents_secrets'] })

    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'typed-token' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await getClock().runAllAsync()
    })

    await waitForElement(() => screen.queryByPlaceholderText('Token set'))
    expect(screen.getByRole('button', { name: 'Remove token' })).toBeInTheDocument()
  })

  it('hides the Clear affordance in the same mounted field right after clicking Remove token', async () => {
    await setAgentBearerToken(getDb(), AGENT_ID, 'pre-existing-token')
    renderWithReactivity(<AgentTokenField agentId={AGENT_ID} />, { tables: ['agents_secrets'] })

    const clearButton = await waitForElement(() => screen.queryByRole('button', { name: 'Remove token' }))
    await act(async () => {
      fireEvent.click(clearButton)
      await getClock().runAllAsync()
    })

    await waitForElement(() => screen.queryByPlaceholderText('Paste the agent access token'))
    expect(screen.queryByRole('button', { name: 'Remove token' })).not.toBeInTheDocument()
  })
})
