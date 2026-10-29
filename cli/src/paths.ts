/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** Shared filesystem locations for persistent CLI state. */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { envVar, envVarNames, stateDirName } from './fork/identity.ts'

/** Root for all CLI state: `~/.volt`, overridable via `VOLT_HOME` (and still
 *  `THUNDERBOLT_HOME`), which enables isolated identities for testing and
 *  multi-account use.
 *
 *  Fork: the directory is NOT read from upstream's `~/.thunderbolt` when ours is
 *  absent, deliberately. This fork never shipped a CLI, so any such directory
 *  belongs to the UPSTREAM binary — inheriting its `auth.json` would mean two
 *  different tools sharing one account state, which is the problem the rename
 *  exists to avoid. */
export const thunderboltHomeDir = (
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string => envVar('HOME', env) ?? join(home, stateDirName)

/** The override's current and legacy spellings, for help text. */
export const homeEnvVarNames = envVarNames('HOME')

/** Resolves persisted CLI config path. */
export const configPath = (env: Readonly<Record<string, string | undefined>> = process.env): string =>
  join(thunderboltHomeDir(env), 'config.json')

/** Resolves persisted CLI account installation path. */
export const authConfigPath = (env: Readonly<Record<string, string | undefined>> = process.env): string =>
  join(thunderboltHomeDir(env), 'auth.json')
