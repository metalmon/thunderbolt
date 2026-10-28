/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'
import { LocalModeBanner } from './local-mode-banner'

afterEach(() => {
  cleanup()
  useLocalSettingsStore.setState({ operationMode: initialLocalSettings.operationMode })
})

describe('LocalModeBanner', () => {
  it('states the condition in local mode', () => {
    useLocalSettingsStore.setState({ operationMode: 'local' })
    render(<LocalModeBanner />)

    expect(screen.getByRole('note')).toHaveTextContent(/this device only/i)
  })

  it('renders nothing in server mode', () => {
    useLocalSettingsStore.setState({ operationMode: 'server' })
    const { container } = render(<LocalModeBanner />)

    expect(container.firstChild).toBeNull()
  })

  // A banner nobody mounts says nothing, and no other test would notice its
  // absence — the app renders fine without it, just silently.
  it('is mounted in the app shell', () => {
    const app = readFileSync('src/app.tsx', 'utf8')
    expect(app.includes('LocalModeBanner')).toBe(true)
  })
})
