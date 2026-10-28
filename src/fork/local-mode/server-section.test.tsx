/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'
import { ServerSection } from './server-section'

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

  it('saves a valid address', () => {
    render(<ServerSection />)
    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'https://other.example.ru/v1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }))

    expect(useLocalSettingsStore.getState().cloudUrl).toBe('https://other.example.ru/v1')
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
    const page = readFileSync('src/settings/preferences.tsx', 'utf8')
    expect(page.includes('ServerSection')).toBe(true)
  })
})
