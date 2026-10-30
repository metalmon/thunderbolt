/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { initialLocalSettings, useLocalSettingsStore } from '@/stores/local-settings-store'
import { LocalModeBanner } from './local-mode-banner'
import { readRepoFile } from '../testing/source-file'

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
  //
  // ⚠ WHERE it is mounted is half the contract. Beside the router it has no row
  // of its own: the app below takes the viewport and the banner is squeezed
  // into a vertical strip of clipped text over the sidebar. Shipped that way in
  // 0.1.148. It belongs in the shell column that holds the other banners.
  it('is mounted in the shell column, not beside the router', () => {
    expect(readRepoFile('src/layout/main-layout.tsx').includes('<LocalModeBanner />')).toBe(true)
    expect(readRepoFile('src/app.tsx').includes('LocalModeBanner')).toBe(false)
  })
})
