/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { AddCustomAgentForm, type AddCustomAgentPayload, type TestAcpConnectionFn } from './add-custom-agent-form'
import { PairingError } from '@/fork/agent-pairing/pair-over-acp'

afterEach(() => {
  cleanup()
})

describe('AddCustomAgentForm', () => {
  const notIos = () => false

  const succeedingProbe: TestAcpConnectionFn = async () => ({ success: true })

  it('keeps Add Agent disabled until both name and URL are filled and the connection test succeeds', async () => {
    const onSubmit = mock(async () => {})
    const onClose = mock(() => {})
    render(
      <AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} testAcpConnection={succeedingProbe} />,
    )

    const submit = screen.getByRole('button', { name: /add agent/i })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My Agent' } })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })
    // Name + URL alone no longer enable Add — a successful test is required.
    expect(submit).toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })
    expect(submit).not.toBeDisabled()
  })

  it('invokes onSubmit with websocket transport and trimmed values', async () => {
    const onSubmit = mock(async (_: AddCustomAgentPayload) => {})
    const onClose = mock(() => {})
    render(
      <AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} testAcpConnection={succeedingProbe} />,
    )

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '  My Agent  ' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: '  wss://example.com/ws  ' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Demo' } })

    // Add is gated behind a successful test — run it first.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'My Agent',
      url: 'wss://example.com/ws',
      description: 'Demo',
      transport: 'websocket',
      authToken: null,
    })
    // Closes the panel on success.
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('includes the entered access token in the submit payload', async () => {
    const onSubmit = mock(async (_: AddCustomAgentPayload) => {})
    const onClose = mock(() => {})
    render(
      <AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} testAcpConnection={succeedingProbe} />,
    )

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'GOST' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://gw.example/acp?agent=gost' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Token' }))
    fireEvent.change(screen.getByLabelText(/access token/i), { target: { value: 'zc_abc' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    })

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ authToken: 'zc_abc' }))
  })

  it('offers connect-by-code by default and swaps in the token field on demand', () => {
    const onSubmit = mock(async () => {})
    const onClose = mock(() => {})
    render(
      <AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} testAcpConnection={succeedingProbe} />,
    )

    // Pairing is the default path — the raw-token field is one click away.
    expect(screen.getByLabelText('Connection code')).toBeInTheDocument()
    expect(screen.queryByLabelText(/access token/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Token' }))
    expect(screen.getByLabelText(/access token/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Connection code')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Connection code' }))
    expect(screen.getByLabelText('Connection code')).toBeInTheDocument()
  })

  it('pairs the code as part of the connection test and probes with the new token', async () => {
    const onSubmit = mock(async (_: AddCustomAgentPayload) => {})
    const onClose = mock(() => {})
    const pair = mock(async () => ({ token: 'zc_from_code' }))
    const probe = mock<TestAcpConnectionFn>(async () => ({ success: true }))
    render(
      <AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} testAcpConnection={probe} pair={pair} />,
    )

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'GOST' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://gw.example/acp' } })
    fireEvent.change(screen.getByLabelText('Connection code'), { target: { value: 'ABC123' } })

    // One button does both: exchange the code, then probe with what it bought.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    expect(pair).toHaveBeenCalledWith({ url: 'wss://gw.example/acp', code: 'ABC123' })
    expect(probe).toHaveBeenCalledWith({ url: 'wss://gw.example/acp', authToken: 'zc_from_code' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    })

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ authToken: 'zc_from_code' }))
  })

  it('pairs again when the code changes, instead of reusing the token it already has', async () => {
    let issued = 0
    const pair = mock(async (_inputs: { url: string; code: string }) => ({ token: `zc_token_${++issued}` }))
    const probe = mock<TestAcpConnectionFn>(async () => ({ success: true }))
    render(
      <AddCustomAgentForm onClose={() => {}} onSubmit={async () => {}} isIos={notIos} testAcpConnection={probe} pair={pair} />,
    )

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://gw.example/acp' } })
    fireEvent.change(screen.getByLabelText('Connection code'), { target: { value: 'FIRST' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    // A code is one-time, so the user who retries types a NEW one — and that
    // one has to be exchanged, not shadowed by the token the first one bought
    // (which is how a permission-less token kept being retried against a live
    // pilot until the 401 was traced back to here).
    fireEvent.change(screen.getByLabelText('Connection code'), { target: { value: 'SECOND' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    expect(pair).toHaveBeenCalledTimes(2)
    expect(pair).toHaveBeenLastCalledWith({ url: 'wss://gw.example/acp', code: 'SECOND' })
    expect(probe).toHaveBeenLastCalledWith({ url: 'wss://gw.example/acp', authToken: 'zc_token_2' })
  })

  it('reports a failed exchange as the connection result and never probes', async () => {
    const pair = mock(async () => {
      throw new PairingError('invalid_code', 'nope')
    })
    const probe = mock<TestAcpConnectionFn>(async () => ({ success: true }))
    render(
      <AddCustomAgentForm onClose={() => {}} onSubmit={async () => {}} isIos={notIos} testAcpConnection={probe} pair={pair} />,
    )

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://gw.example/acp' } })
    fireEvent.change(screen.getByLabelText('Connection code'), { target: { value: 'BAD' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    expect(probe).not.toHaveBeenCalled()
    expect(screen.getByText("That code didn't work. Check it and try again.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add agent/i })).toBeDisabled()
  })

  it('keeps the dialog open with submit re-enabled when onSubmit rejects', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    const onSubmit = mock(async () => {
      throw new Error('insert failed')
    })
    const onClose = mock(() => {})
    render(
      <AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} testAcpConnection={succeedingProbe} />,
    )

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My Agent' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    // The form stays open and intact so the user can retry.
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/name/i)).toHaveValue('My Agent')
    expect(screen.getByRole('button', { name: /add agent/i })).not.toBeDisabled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('shows the iOS rejection inline for ws:// at render time, keeps Add disabled, and does NOT call onSubmit', () => {
    const onSubmit = mock(async () => {})
    const onClose = mock(() => {})
    render(<AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={() => true} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'iOS Agent' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'ws://example.com/ws' } })

    // The error surfaces on entering the invalid URL — no Add click needed.
    expect(screen.getByRole('alert')).toHaveTextContent(/secure/i)
    expect(screen.getByRole('button', { name: /add agent/i })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows an inline error for http:// (unsupported scheme) at render time and keeps Add disabled', () => {
    const onSubmit = mock(async () => {})
    const onClose = mock(() => {})
    render(<AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bad Agent' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'http://example.com' } })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add agent/i })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('shows an inline error for unsupported schemes at render time and keeps Add disabled', () => {
    const onSubmit = mock(async () => {})
    const onClose = mock(() => {})
    render(<AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} />)

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Bad Agent' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'ftp://example.com' } })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add agent/i })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('AddCustomAgentForm — connection status', () => {
  const notIos = () => false

  const renderWithProbe = (testAcpConnection: TestAcpConnectionFn) => {
    const onSubmit = mock(async () => {})
    const onClose = mock(() => {})
    render(
      <AddCustomAgentForm onClose={onClose} onSubmit={onSubmit} isIos={notIos} testAcpConnection={testAcpConnection} />,
    )
    return { onSubmit, onClose }
  }

  const fillNameAndUrl = () => {
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'My Agent' } })
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })
  }

  it('hides the Test Connection button until the URL is a valid WebSocket endpoint', () => {
    renderWithProbe(async () => ({ success: true }))

    expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'http://example.com' } })
    expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })
    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument()
  })

  it('renders the success StatusCard when the probe resolves success', async () => {
    const probe = mock<TestAcpConnectionFn>(async () => ({ success: true }))
    renderWithProbe(probe)

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    expect(probe).toHaveBeenCalledWith({ url: 'wss://example.com/ws', authToken: null })
    expect(screen.getByText(/connection successful/i)).toBeInTheDocument()
  })

  it('passes the entered access token to the connection probe', async () => {
    const probe = mock<TestAcpConnectionFn>(async () => ({ success: true }))
    renderWithProbe(probe)

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Token' }))
    fireEvent.change(screen.getByLabelText(/access token/i), { target: { value: 'zc_abc' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    expect(probe).toHaveBeenCalledWith({ url: 'wss://example.com/ws', authToken: 'zc_abc' })
  })

  it('renders the error StatusCard with the probe error message on failure', async () => {
    const probe = mock<TestAcpConnectionFn>(async () => ({ success: false, error: 'Could not reach agent' }))
    renderWithProbe(probe)

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    expect(screen.getByText(/connection failed/i)).toBeInTheDocument()
    expect(screen.getByText(/could not reach agent/i)).toBeInTheDocument()
  })

  it('gates Add Agent on a successful connection test', async () => {
    renderWithProbe(async () => ({ success: false, error: 'nope' }))

    const submit = screen.getByRole('button', { name: /add agent/i })
    fillNameAndUrl()

    // Name + URL alone do not enable Add.
    expect(submit).toBeDisabled()

    // A failed test leaves Add disabled.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })
    expect(submit).toBeDisabled()

    // Re-entering a valid URL clears the failure; a successful test enables Add.
    cleanup()
    renderWithProbe(async () => ({ success: true }))
    const submitAfterSuccess = screen.getByRole('button', { name: /add agent/i })
    fillNameAndUrl()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })
    expect(submitAfterSuccess).not.toBeDisabled()
  })

  it('clears a prior connection result when the URL changes', async () => {
    renderWithProbe(async () => ({ success: true }))

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })
    expect(screen.getByText(/connection successful/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://other.com/ws' } })
    expect(screen.queryByText(/connection successful/i)).not.toBeInTheDocument()
  })
})

describe('AddCustomAgentForm — iroh', () => {
  const notIos = () => false
  const irohTarget = 'a'.repeat(52)
  const appNodeId = 'b'.repeat(52)
  // Stable reference so the load effect's deps don't churn across renders.
  const loadAppNodeId = async () => appNodeId

  const renderIroh = () => {
    const onSubmit = mock(async (_: AddCustomAgentPayload) => {})
    const onClose = mock(() => {})
    render(
      <AddCustomAgentForm
        onClose={onClose}
        onSubmit={onSubmit}
        isIos={notIos}
        testAcpConnection={async () => ({ success: true })}
        loadAppNodeId={loadAppNodeId}
      />,
    )
    return { onSubmit, onClose }
  }

  it('hides Test Connection for an iroh target and gates Add on name + valid target only', async () => {
    renderIroh()
    const submit = screen.getByRole('button', { name: /add agent/i })

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Laptop Bridge' } })
    expect(submit).toBeDisabled()

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: irohTarget } })
    })

    // Test Connection is WebSocket-only — an iroh bridge is verified on first chat.
    expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument()
    // No connection test is required for iroh, so Add is enabled directly.
    expect(submit).not.toBeDisabled()
  })

  it('hides the access token field for an iroh target — there is no ws subprotocol channel to deliver it on', async () => {
    renderIroh()

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: irohTarget } })
    })

    expect(screen.queryByLabelText(/access token/i)).not.toBeInTheDocument()
  })

  it('shows this app NodeId as an allow command with a copy button', async () => {
    renderIroh()

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: irohTarget } })
    })

    const panel = screen.getByTestId('iroh-pairing-panel')
    await waitFor(() => expect(panel.textContent).toContain(`thunderbolt iroh allow ${appNodeId}`))
    expect(screen.getByRole('button', { name: /copy allow command/i })).toBeInTheDocument()
  })

  it('surfaces an error when the app pairing identity fails to load', async () => {
    const onSubmit = mock(async () => {})
    render(
      <AddCustomAgentForm
        onClose={() => {}}
        onSubmit={onSubmit}
        isIos={notIos}
        loadAppNodeId={async () => {
          throw new Error('relay unreachable')
        }}
      />,
    )

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: irohTarget } })
    })

    const panel = screen.getByTestId('iroh-pairing-panel')
    await waitFor(() => expect(panel.textContent).toMatch(/relay unreachable/i))
  })

  it('re-loads the app NodeId after the target is cleared and re-entered (no stuck "Loading")', async () => {
    let calls = 0
    const countingLoad = async () => {
      calls += 1
      return appNodeId
    }
    render(
      <AddCustomAgentForm
        onClose={() => {}}
        onSubmit={async () => {}}
        isIos={notIos}
        testAcpConnection={async () => ({ success: true })}
        loadAppNodeId={countingLoad}
      />,
    )

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: irohTarget } })
    })
    await waitFor(() => expect(screen.getByTestId('iroh-pairing-panel').textContent).toContain(appNodeId))
    expect(calls).toBe(1)

    // Clearing the target disarms the loader (appNodeId back to idle).
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: '' } })
    })

    // Re-entering an iroh target must re-fire the load rather than strand on "Loading".
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: irohTarget } })
    })
    await waitFor(() => expect(screen.getByTestId('iroh-pairing-panel').textContent).toContain(appNodeId))
    expect(calls).toBe(2)
  })

  it('does not persist a token typed before the URL was switched to an iroh target', async () => {
    const { onSubmit } = renderIroh()

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Laptop Bridge' } })
    // Start on a websocket URL — the token field is visible — and type a token.
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'wss://example.com/ws' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Token' }))
    fireEvent.change(screen.getByLabelText(/access token/i), { target: { value: 'zc_stale' } })

    // Switching the target to iroh hides the field, but the typed value stays
    // in form state — the submit payload must not carry it through.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: irohTarget } })
    })
    expect(screen.queryByLabelText(/access token/i)).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    })

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ transport: 'iroh', authToken: null }))
  })

  it('submits with transport: iroh and the target stored as url', async () => {
    const { onSubmit, onClose } = renderIroh()

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '  Laptop Bridge  ' } })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/url/i), { target: { value: `  ${irohTarget}  ` } })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /add agent/i }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Laptop Bridge',
      url: irohTarget,
      description: null,
      transport: 'iroh',
      authToken: null,
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
