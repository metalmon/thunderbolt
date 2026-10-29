/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useConfigStore } from '@/api/config-store'
import { getAuthToken, setAuthToken } from '@/lib/auth-token'
import { getCachedSession, setCachedSession } from '@/lib/session-cache'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'
import { ServerSection } from './server-section'
import { readRepoFile } from '../testing/source-file'

const env = import.meta.env as Record<string, string | undefined>

beforeEach(() => {
  env.VITE_VOLT_ALLOW_SERVER_EDIT = 'true'
  useLocalSettingsStore.setState({ operationMode: 'server', cloudUrl: 'https://backend.example.ru/v1' })
})

afterEach(() => {
  cleanup()
  delete env.VITE_VOLT_ALLOW_SERVER_EDIT
  useLocalSettingsStore.setState({
    operationMode: initialLocalSettings.operationMode,
    cloudUrl: initialLocalSettings.cloudUrl,
    syncEnabled: initialLocalSettings.syncEnabled,
  })
})

describe('ServerSection', () => {
  // The whole point of the build flag: an OEM delivery must not carry a field
  // that someone can be talked into pasting an address into.
  it('renders nothing when the build does not allow retargeting', () => {
    delete env.VITE_VOLT_ALLOW_SERVER_EDIT
    const { container } = render(<ServerSection />)

    expect(container.firstChild).toBeNull()
  })

  it('refuses to save an address that is not https or loopback http', () => {
    render(<ServerSection />)
    const input = screen.getByLabelText('Server address')
    fireEvent.change(input, { target: { value: 'http://backend.example.ru/v1' } })

    expect(screen.getByText(/Only https is allowed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save address' })).toBeDisabled()
    // Nothing was written: a refused address must not reach the store.
    expect(useLocalSettingsStore.getState().cloudUrl).toBe('https://backend.example.ru/v1')
  })

  // Found by review, and it condemned the first version of this file: "Save
  // address" wrote the store directly. That bypassed the one thing the dialog
  // exists for — the user reading back the host before credentials go there —
  // on exactly the path most likely to be used by persuasion.
  it('does not retarget the backend without confirmation', () => {
    render(<ServerSection />)
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://other.example.ru/v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }))

    expect(useLocalSettingsStore.getState().cloudUrl).toBe('https://backend.example.ru/v1')
    expect(screen.getByText('other.example.ru')).toBeInTheDocument()
  })

  // The second half of the same finding: a token issued by one backend must
  // never be presented to a different one.
  it('signs out and stops sync when the host actually changes', async () => {
    setAuthToken('token-from-the-old-server')
    setCachedSession({ user: { id: 'u1' }, session: { expiresAt: new Date(Date.now() + 86_400_000) } })
    useLocalSettingsStore.setState({ syncEnabled: true })
    render(<ServerSection />)
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://other.example.ru/v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect and keep local data' }))
    })

    expect(useLocalSettingsStore.getState().cloudUrl).toBe('https://other.example.ru/v1')
    expect(getAuthToken()).toBeFalsy()
    expect(getCachedSession()).toBeNull()
    // The cached `/config` describes the OLD deployment — auth mode, branding,
    // the OTA model set — and must not survive a change of host.
    expect(useConfigStore.getState().config).toEqual({})
    // ⚠ `syncEnabled` is deliberately NOT asserted here. Two upstream suites
    // replace `setSyncEnabled` with a mock that never writes the flag, and that
    // registration is process-wide, so this would pass alone and fail in a full
    // run. The guarantee itself is covered in `switch-mode.test.ts`, which
    // injects the dependency instead of importing it.
  })

  // Leaving local mode is where this device's unowned history could be claimed
  // by the first account to sign in, so the choice is offered BEFORE the switch.
  it('offers the data choice before connecting a server, naming the host', () => {
    useLocalSettingsStore.setState({ operationMode: 'local' })
    render(<ServerSection />)
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://pilot.example.ru/v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect this server' }))

    expect(screen.getByText('pilot.example.ru')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect and keep local data' })).toBeInTheDocument()
    expect(screen.getByText(/Connect and start clean/)).toBeInTheDocument()
    // Still local until the choice is made.
    expect(useLocalSettingsStore.getState().operationMode).toBe('local')
  })

  it('switches to server mode only after the choice is taken', () => {
    useLocalSettingsStore.setState({ operationMode: 'local' })
    render(<ServerSection />)
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://pilot.example.ru/v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect this server' }))
    fireEvent.click(screen.getByRole('button', { name: 'Connect and keep local data' }))

    expect(useLocalSettingsStore.getState().operationMode).toBe('server')
    expect(useLocalSettingsStore.getState().cloudUrl).toBe('https://pilot.example.ru/v1')
  })

  // A section nobody mounts is not an editor.
  it('is mounted in the preferences page', () => {
    const page = readRepoFile('src/settings/preferences.tsx')
    expect(page.includes('ServerSection')).toBe(true)
  })
})
