/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { displayName } from '../fork/identity.ts'
import { i18n } from '../fork/i18n.ts'
import type { CommandOutcome, ProviderManagerMode, ProviderManagerRunner } from './types.ts'

type RoutedSlashCommand = {
  readonly name: string
  readonly description: string
  readonly mode: ProviderManagerMode | 'permissions'
}

/**
 * Reserved commands shared by routing and interactive autocomplete.
 *
 * ⚠ A function, not a constant: module scope is evaluated before the stored
 * language preference has been read, so a constant table would pin the boot
 * language for the whole run.
 */
export const slashCommands = (): RoutedSlashCommand[] => [
  { name: 'providers', description: i18n._({ id: 'Manage provider profiles' }), mode: 'providers' },
  { name: 'models', description: i18n._({ id: 'Choose the active model' }), mode: 'models' },
  { name: 'login', description: i18n._({ id: 'Sign in to {app}', values: { app: displayName } }), mode: 'login' },
  { name: 'logout', description: i18n._({ id: 'Sign out of {app}', values: { app: displayName } }), mode: 'logout' },
  { name: 'permissions', description: i18n._({ id: 'Choose the permission mode' }), mode: 'permissions' },
  { name: 'language', description: i18n._({ id: 'Choose the interface language' }), mode: 'language' },
]

/** Identifies state reconciliation that must complete even when cancellation raced with its response. */
export const mustApplyAfterCancellation = (outcome: CommandOutcome): boolean => outcome.kind === 'deactivate'

/** Creates the shared pure text router for provider commands and agent input. */
export const createCommandRouter = (
  manager: ProviderManagerRunner,
  permissions: () => Promise<CommandOutcome>,
) => ({
  handle: async (text: string): Promise<CommandOutcome> => {
    const command = slashCommands().find(({ name }) => text === `/${name}`)
    if (command?.mode === 'permissions') return permissions()
    if (command) return manager(command.mode)
    if (text === 'exit' || text === 'quit') return { kind: 'exit' }
    return { kind: 'forward', text }
  },
})
