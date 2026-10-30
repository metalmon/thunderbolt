/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg } from '@lingui/core/macro'
import type { I18n, MessageDescriptor } from '@lingui/core'
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { Arch, Platform } from '@tauri-apps/plugin-os'

import { isRecord } from '@/lib/utils'

export type CliInstallPlatform = Platform | 'web'
export type CliInstallArchitecture = Arch | 'unknown'

/** A successful one-click install of the `thunderbolt` CLI, mirroring the Rust
 *  `CliInstallResult` (serialized camelCase). */
export type CliInstallResult = {
  /** Absolute path the binary was installed to (`~/.local/bin/thunderbolt`). */
  path: string
  /** Whether `~/.local/bin` is already on the user's `PATH`. */
  onPath: boolean
  /** Shell line to add the install dir to `PATH`; present only when `onPath` is false. */
  pathHint: string | null
}

/** The typed failure kinds the Rust `install_thunderbolt_cli` command returns. */
export type CliInstallErrorKind = 'unsupported' | 'notPublished' | 'download' | 'checksumMismatch' | 'install'

/** A typed install failure, mirroring the Rust `CliInstallError` (`{ kind, message }`). */
export type CliInstallError = {
  kind: CliInstallErrorKind
  message: string
}

const cliInstallErrorKinds: ReadonlyArray<CliInstallErrorKind> = [
  'unsupported',
  'notPublished',
  'download',
  'checksumMismatch',
  'install',
]

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

/**
 * Invokes the Rust command that downloads, checksum-verifies and installs the
 * prebuilt `thunderbolt` CLI into `~/.local/bin`. Resolves with the install
 * result or rejects with a {@link CliInstallError}.
 *
 * @param invoke - Injectable Tauri `invoke` (production omits; tests supply a fake).
 */
export const installThunderboltCli = (invoke: InvokeFn = tauriInvoke): Promise<CliInstallResult> =>
  invoke<CliInstallResult>('install_thunderbolt_cli')

/**
 * Fork: the result of adding the CLI's directory to the user's persistent
 * `PATH`. `alreadyPresent` is reported rather than swallowed so the UI can say
 * "already there" instead of claiming it changed something.
 */
export type CliPathUpdate = { alreadyPresent: boolean; dir: string }

/** Fork: what a `PATH` change would touch on this machine — the Windows user
 *  environment, or the shell startup file the user actually reads. Named in the
 *  confirmation, because the change outlives the app. */
export const cliPathTarget = (invoke: InvokeFn = tauriInvoke): Promise<string> => invoke<string>('cli_path_target')

/** Fork: append the CLI's install directory to the user's `PATH`. Always called
 *  behind an explicit confirmation (see `AddToPathButton`). */
export const addCliDirToPath = async (invoke: InvokeFn = tauriInvoke): Promise<CliPathUpdate> => {
  const raw = await invoke<Record<string, { dir: string }>>('add_cli_dir_to_path')
  // Rust returns a serde-tagged enum: `{ added: { dir } }` or
  // `{ alreadyPresent: { dir } }`.
  const alreadyPresent = 'alreadyPresent' in raw
  return { alreadyPresent, dir: (raw.alreadyPresent ?? raw.added)?.dir ?? '' }
}

/**
 * Whether the CLI release pipeline publishes a prebuilt binary for this
 * OS/architecture pair. Mirrors Rust `resolve_target`. Callers gate on the
 * Tauri runtime separately — this is a pure target lookup.
 */
export const canInstallThunderboltCli = (platform: CliInstallPlatform, architecture: CliInstallArchitecture): boolean =>
  (platform === 'macos' && architecture === 'aarch64') ||
  (platform === 'linux' && (architecture === 'x86_64' || architecture === 'aarch64')) ||
  // Fork: Windows is the pilot's primary platform and `cli-release.yml` builds
  // it. ⚠ This gate runs BEFORE the Rust side: a target missing here hides the
  // row entirely, so `resolve_target` is never consulted and the omission looks
  // like the feature does not exist rather than like a bug.
  (platform === 'windows' && architecture === 'x86_64')

/** Narrows an unknown rejection value to a typed {@link CliInstallError}. */
export const isCliInstallError = (value: unknown): value is CliInstallError =>
  isRecord(value) &&
  typeof value.kind === 'string' &&
  cliInstallErrorKinds.includes(value.kind as CliInstallErrorKind) &&
  typeof value.message === 'string'

/** UI-ready view of a failed install. */
export type CliInstallErrorView = {
  message: string
  /** Whether to offer the manual "build from source" fallback — only when there
   *  is genuinely no prebuilt binary to install (unsupported platform or a
   *  release that predates the CLI pipeline). */
  showManualBuild: boolean
}

/**
 * Maps any install rejection to a message plus whether to surface the manual
 * build fallback. `unsupported` and `notPublished` mean no binary exists to
 * download, so the honest next step is building from source; every other kind is
 * a transient/operational failure the user can retry.
 */
/**
 * Fork: what the user reads for each failure.
 *
 * The Rust side's own strings cross the boundary in English and name the
 * upstream product — a user reported reading "This release has no prebuilt
 * Thunderbolt CLI yet" in an otherwise Russian app. Per the house rule, the
 * thrown error stays English and the DISPLAY boundary translates, so the kind
 * is the contract and the sentence is ours. Descriptors at module scope,
 * resolved at the point of use: a `t` here would freeze the boot locale.
 */
const cliInstallErrorMessages: Record<CliInstallErrorKind, MessageDescriptor> = {
  unsupported: msg`No CLI is published for this platform yet. You can build it from source.`,
  notPublished: msg`This release has no CLI to download yet. You can build it from source.`,
  download: msg`The download failed. Check the connection to the release server and try again.`,
  checksumMismatch: msg`The downloaded file did not match its checksum, so nothing was installed. Try again.`,
  install: msg`The file downloaded but could not be installed. Check that the install directory is writable.`,
}

export const describeCliInstallError = (error: unknown, i18n: I18n): CliInstallErrorView => {
  if (isCliInstallError(error)) {
    return {
      message: i18n._(cliInstallErrorMessages[error.kind]),
      showManualBuild: error.kind === 'unsupported' || error.kind === 'notPublished',
    }
  }
  return { message: String(error), showManualBuild: false }
}
