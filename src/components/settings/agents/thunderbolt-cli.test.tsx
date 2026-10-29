/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { getClock } from '@/testing-library'
import type { CliInstallError, CliInstallResult } from '@/lib/cli-install'
import { ThunderboltCliDetail, ThunderboltCliRow } from './thunderbolt-cli'

const writeTextMock = mock(() => Promise.resolve())
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: writeTextMock },
  configurable: true,
})

afterEach(() => {
  cleanup()
  writeTextMock.mockClear()
})

const noop = () => {}

const renderRow = (props: Partial<Parameters<typeof ThunderboltCliRow>[0]> = {}) =>
  render(<ThunderboltCliRow onOpen={noop} platform="macos" architecture="aarch64" isTauriEnv={true} {...props} />)

const renderDetail = (props: Partial<Parameters<typeof ThunderboltCliDetail>[0]> = {}) =>
  render(<ThunderboltCliDetail onClose={noop} isTauriEnv={true} {...props} />)

const clickInstall = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /install cli/i }))
    await getClock().runAllAsync()
  })
}

describe('ThunderboltCliRow', () => {
  // Fork: the standalone CLI is not distributed in the closed perimeter, so
  // The row is back (the fork used to hide it everywhere), so the platform gate
  // matters again — and Windows is now on the published side of it.
  it('renders on Windows x64 — the pilot platform the fork builds for', () => {
    const { container } = renderRow({ platform: 'windows', architecture: 'x86_64' })
    expect(container).not.toBeEmptyDOMElement()
  })

  it('renders nothing where no binary is published', () => {
    for (const props of [
      // Intel macOS: the iroh addon has no build for it.
      { platform: 'macos' as const, architecture: 'x86_64' as const },
      { platform: 'windows' as const, architecture: 'aarch64' as const },
      { platform: 'ios' as const },
    ]) {
      const { container } = renderRow(props)
      expect(container).toBeEmptyDOMElement()
      cleanup()
    }
  })
})

describe('ThunderboltCliDetail', () => {
  it('renders the install action on Tauri desktop', () => {
    renderDetail()
    expect(screen.getByRole('button', { name: /install cli/i })).toBeInTheDocument()
  })

  it('calls onClose from the header close button', () => {
    const onClose = mock(() => {})
    renderDetail({ onClose })

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the install guide on web instead of the one-click install action', () => {
    renderDetail({ isTauriEnv: false })

    const guideLink = screen.getByRole('link', { name: /view install guide/i })
    expect(guideLink).toHaveAttribute(
      'href',
      'https://github.com/thunderbird/thunderbolt/blob/main/cli/README.md#install',
    )
    expect(guideLink).toHaveAttribute('target', '_blank')
    expect(guideLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Use Thunderbolt from the command line.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /install cli/i })).not.toBeInTheDocument()
  })

  it('shows the installed path on success', async () => {
    const result: CliInstallResult = { path: '/home/u/.local/bin/thunderbolt', onPath: true, pathHint: null }
    renderDetail({ install: () => Promise.resolve(result) })

    await clickInstall()

    expect(screen.getByText('/home/u/.local/bin/thunderbolt')).toBeInTheDocument()
    expect(screen.queryByText(/add.*to your PATH/i)).not.toBeInTheDocument()
  })

  it('offers to add the directory to PATH, and keeps the line to paste', async () => {
    const hint = 'export PATH="$HOME/.local/bin:$PATH"'
    const result: CliInstallResult = { path: '/home/u/.local/bin/thunderbolt', onPath: false, pathHint: hint }
    renderDetail({ install: () => Promise.resolve(result) })

    await clickInstall()

    // The app now OFFERS to do it (behind a confirmation), and keeps the line to
    // paste underneath for anyone who would rather do it by hand.
    expect(screen.getByRole('button', { name: 'Add to PATH' })).toBeInTheDocument()
    expect(screen.getByText(hint)).toBeInTheDocument()
  })

  it('shows the error message and the manual build fallback for an unpublished release', async () => {
    const error: CliInstallError = { kind: 'notPublished', message: 'This release has no prebuilt CLI yet.' }
    renderDetail({ install: () => Promise.reject(error) })

    await clickInstall()

    expect(screen.getByText('This release has no prebuilt CLI yet.')).toBeInTheDocument()
    expect(screen.getByText('cd cli && bun install && bun run build && ./install.sh')).toBeInTheDocument()
  })

  it('shows the error without the build fallback for an operational failure', async () => {
    const error: CliInstallError = { kind: 'checksumMismatch', message: 'Checksum mismatch. Install aborted.' }
    renderDetail({ install: () => Promise.reject(error) })

    await clickInstall()

    expect(screen.getByText('Checksum mismatch. Install aborted.')).toBeInTheDocument()
    expect(screen.queryByText(/build it from source/i)).not.toBeInTheDocument()
  })
})
