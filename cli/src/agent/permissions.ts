/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isReadOnlyAgentTool } from '../../../shared/agent-tool-permissions.ts'
import type { HarnessRuntime, ProviderManagerIO, ProviderManagerItem } from '../provider-runtime/types.ts'
import { sanitizePermissionText } from '../ui/render.ts'
import type { PermissionPrompt, PermissionRequest } from './types.ts'
import { i18n } from '../fork/i18n.ts'

export const permissionModeCycle = ['ask', 'accept-edits', 'read-only', 'yolo'] as const

export type PermissionMode = (typeof permissionModeCycle)[number]

/**
 * Fork: a function, not a frozen array. The labels are read by a person, so they
 * are localized — and resolving them at module scope would pin them to whatever
 * the language was when the module first loaded. A CLI process has exactly one
 * language, so that would work today, but it is the mistake the app's own i18n
 * notes call out, and it costs nothing to avoid.
 *
 * The ids stay literal: they are compared and stored.
 */
/**
 * The short label the footer shows for the active mode. Lower case because it
 * sits inside a sentence fragment ("разрешения спросить"), unlike the menu's
 * `permissionModeItems`, whose labels head their own rows — but both resolve
 * the SAME catalog entries, so the menu and the footer can never disagree.
 */
export const permissionModeLabel = (mode: PermissionMode): string =>
  ({
    ask: i18n._({ id: 'Ask' }),
    'accept-edits': i18n._({ id: 'Accept edits' }),
    'read-only': i18n._({ id: 'Read only' }),
    yolo: i18n._({ id: 'Yolo' }),
  })[mode].toLocaleLowerCase()

export const permissionModeItems = (): readonly (ProviderManagerItem & { readonly id: PermissionMode })[] => [
  { id: 'ask', label: i18n._({ id: 'Ask' }), description: i18n._({ id: 'Prompt before bash, write, and edit' }) },
  {
    id: 'accept-edits',
    label: i18n._({ id: 'Accept edits' }),
    description: i18n._({ id: 'Allow write and edit; ask before bash' }),
  },
  {
    id: 'read-only',
    label: i18n._({ id: 'Read only' }),
    description: i18n._({ id: 'Block bash, write, and edit' }),
  },
  { id: 'yolo', label: i18n._({ id: 'Yolo' }), description: i18n._({ id: 'Allow every tool call' }) },
]

/** ⚠ Model-facing: this reason is returned as the tool result the agent reads,
 *  so it stays English. Translating it would be translating an instruction. */
export const readOnlyBlockReason = 'blocked: read-only mode — propose the change instead of applying it'

/** Advances to the next permission mode. */
export const cyclePermissionMode = (mode: PermissionMode): PermissionMode =>
  permissionModeCycle[(permissionModeCycle.indexOf(mode) + 1) % permissionModeCycle.length]!

/** Opens the shared manager picker and returns the selected permission mode. */
export const choosePermissionMode = async (
  io: ProviderManagerIO,
  currentMode: PermissionMode,
): Promise<PermissionMode> => {
  const selected = await io.choose(i18n._({ id: 'Permissions' }), permissionModeItems())
  return permissionModeCycle.find((mode) => mode === selected) ?? currentMode
}

/**
 * Builds the one-line summary shown to the user for a gated tool call. `bash`
 * summarizes to its command; `write`/`edit` to their target path (both tools
 * use an `input.path` field).
 *
 * @param toolName - the tool being invoked
 * @param input - the tool's validated arguments
 * @returns a human-readable one-liner
 */
const summarize = (toolName: string, input: Record<string, unknown>): string => {
  if (toolName === 'bash' && typeof input.command === 'string') return sanitizePermissionText(input.command)
  if (typeof input.path === 'string') return sanitizePermissionText(input.path)
  return sanitizePermissionText(JSON.stringify(input))
}

/**
 * Registers the interactive tool-permission gate on the harness.
 *
 * The current mode is read for every tool call so interactive changes apply
 * immediately. In `ask`, write/edit/bash calls use {@link PermissionPrompt}:
 * `allow-once` runs it, `allow-session` runs it and allows that tool for the
 * rest of the session, and `deny` blocks it with an error tool result. Read-only
 * tools are always allowed.
 *
 * @param target - the narrow runtime gate registration surface
 * @param opts.getMode - returns the live permission mode
 * @param opts.ask - prompt used to ask the user for a decision
 */
export const attachPermissionGate = (
  target: Pick<HarnessRuntime, 'registerToolCallGate'>,
  opts: { getMode: () => PermissionMode; ask: PermissionPrompt },
): void => {
  const sessionAllowed = new Set<string>()

  target.registerToolCallGate(async ({ toolName, input }) => {
    if (isReadOnlyAgentTool(toolName) || toolName === 'webfetch') return undefined

    const mode = opts.getMode()
    if (mode === 'yolo') return undefined
    if (mode === 'read-only') return { block: true, reason: readOnlyBlockReason }
    if (mode === 'accept-edits' && (toolName === 'write' || toolName === 'edit')) return undefined
    if (mode === 'ask' && sessionAllowed.has(toolName)) return undefined

    const request: PermissionRequest = { toolName, summary: summarize(toolName, input) }
    const decision = await opts.ask(request)
    if (decision === 'allow-once') return undefined
    if (decision === 'allow-session') {
      if (mode === 'ask') sessionAllowed.add(toolName)
      return undefined
    }
    return { block: true, reason: `User denied ${toolName}` }
  })
}
