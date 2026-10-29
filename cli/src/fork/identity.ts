/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The CLI's own identity, in one place.
 *
 * Upstream spells its name into 33 source files — the command in every usage
 * line of the help text, the env-var prefix, the state directory, the banner.
 * Editing all of them would conflict on every sync of a tree that saw 40 commits
 * in its last 90 days, so the name is read from here instead and the invasive
 * surface stays at one import per file.
 *
 * Why the names differ from the gateway's: `voltd` is the advanced gateway
 * (ZeroClaw's half of the kit), this is the free agent that installs from the
 * client. `volt`/`voltd` reads as a client/daemon pair by Unix convention, and
 * that expectation is one we intend to meet rather than dodge — the CLI already
 * speaks ACP as an agent, and teaching it to speak as a client would make `volt`
 * the single command that drives both.
 */

/** The command as the user types it, and the installed binary's name. */
export const commandName = 'volt'

/** The product name as prose, where the typed command would read wrong — "manage
 *  Volt and provider profiles", not "manage volt and provider profiles". Separate
 *  from {@link commandName} because one is typed and the other is read. */
export const displayName = 'Volt'

/** State directory under the user's home, e.g. `~/.volt`. */
export const stateDirName = `.${commandName}`

/** Prefix for this CLI's environment variables. */
export const envPrefix = 'VOLT'

/**
 * The prefix upstream used, still accepted for one release.
 *
 * Not for OUR users — this fork has never shipped a CLI, so nobody has scripts
 * against `VOLT_*` yet. It is for people replacing the upstream binary, whose
 * existing `THUNDERBOLT_*` exports would otherwise go silently ignored, which is
 * the worst of the three possible behaviours (work / refuse / pretend).
 */
export const legacyEnvPrefix = 'THUNDERBOLT'

type Env = Readonly<Record<string, string | undefined>>

/**
 * Read one of this CLI's environment variables, preferring the current name.
 *
 * @param suffix the part after the prefix, e.g. `CLOUD_URL`
 * @returns the current variable's value, else the legacy one's, else undefined
 *
 * @example
 * envVar('CLOUD_URL')            // VOLT_CLOUD_URL, else THUNDERBOLT_CLOUD_URL
 */
export const envVar = (suffix: string, env: Env = process.env): string | undefined =>
  env[`${envPrefix}_${suffix}`] ?? env[`${legacyEnvPrefix}_${suffix}`]

/** Both spellings of a variable, for help text and deprecation notices. */
export const envVarNames = (suffix: string): { current: string; legacy: string } => ({
  current: `${envPrefix}_${suffix}`,
  legacy: `${legacyEnvPrefix}_${suffix}`,
})
