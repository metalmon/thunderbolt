/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'bun:test'
import { i18n } from '@lingui/core'
import { canInstallThunderboltCli, describeCliInstallError, isCliInstallError } from './cli-install'

describe('canInstallThunderboltCli', () => {
  it('offers the install for every published OS and architecture pair', () => {
    expect(canInstallThunderboltCli('macos', 'aarch64')).toBe(true)
    expect(canInstallThunderboltCli('linux', 'x86_64')).toBe(true)
    expect(canInstallThunderboltCli('linux', 'aarch64')).toBe(true)
    // Fork: Windows x64 is built by `cli-release.yml` and is the pilot's primary
    // platform; this gate runs before the Rust one, so omitting it hides the row.
    expect(canInstallThunderboltCli('windows', 'x86_64')).toBe(true)
  })

  it('hides the install for unpublished OS and architecture pairs', () => {
    expect(canInstallThunderboltCli('macos', 'x86_64')).toBe(false)
    expect(canInstallThunderboltCli('windows', 'aarch64')).toBe(false)
    expect(canInstallThunderboltCli('ios', 'aarch64')).toBe(false)
    expect(canInstallThunderboltCli('android', 'aarch64')).toBe(false)
    expect(canInstallThunderboltCli('web', 'unknown')).toBe(false)
  })
})

describe('isCliInstallError', () => {
  it('accepts a well-formed typed error', () => {
    expect(isCliInstallError({ kind: 'notPublished', message: 'nope' })).toBe(true)
    expect(isCliInstallError({ kind: 'checksumMismatch', message: 'bad hash' })).toBe(true)
  })

  it('rejects unknown kinds and malformed shapes', () => {
    expect(isCliInstallError({ kind: 'boom', message: 'x' })).toBe(false)
    expect(isCliInstallError({ kind: 'download' })).toBe(false)
    expect(isCliInstallError({ message: 'x' })).toBe(false)
    expect(isCliInstallError('notPublished')).toBe(false)
    expect(isCliInstallError(null)).toBe(false)
  })
})

describe('describeCliInstallError', () => {
  it('offers the manual build fallback only when no binary exists to install', () => {
    expect(describeCliInstallError({ kind: 'unsupported', message: 'no binary' }, i18n).showManualBuild).toBe(true)
    expect(describeCliInstallError({ kind: 'notPublished', message: 'not yet' }, i18n).showManualBuild).toBe(true)
  })

  it('treats operational failures as retryable, not build-from-source', () => {
    expect(describeCliInstallError({ kind: 'download', message: 'offline' }, i18n).showManualBuild).toBe(false)
    expect(describeCliInstallError({ kind: 'checksumMismatch', message: 'tampered' }, i18n).showManualBuild).toBe(false)
    expect(describeCliInstallError({ kind: 'install', message: 'no perms' }, i18n).showManualBuild).toBe(false)
  })

  // ⚠ Fork: the Rust side's message crosses the boundary in English and names
  // the upstream product. A user read "This release has no prebuilt Thunderbolt
  // CLI yet" in an otherwise Russian app, so the kind — not that string — is
  // what the user sees rendered.
  it('never shows the raw message from the Rust side', () => {
    for (const kind of ['unsupported', 'notPublished', 'download', 'checksumMismatch', 'install'] as const) {
      const { message } = describeCliInstallError({ kind, message: 'RAW RUST DETAIL' }, i18n)
      expect(message).not.toBe('RAW RUST DETAIL')
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('stringifies an untyped rejection without offering the build fallback', () => {
    expect(describeCliInstallError(new Error('ipc failed'), i18n)).toEqual({
      message: 'Error: ipc failed',
      showManualBuild: false,
    })
  })
})
