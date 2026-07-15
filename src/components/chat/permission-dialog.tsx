/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { findAllowOption } from '@/chats/chat-store'
import { Button } from '@/components/ui/button'
import type { TFunction } from 'i18next'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type PermissionDialogProps = {
  onAlwaysAllowAgent: () => void
  onAlwaysAllowTool: () => void
  onRespond: (response: RequestPermissionResponse) => void
  request: RequestPermissionRequest
}

const toolKindLabel = (t: TFunction, kind?: string | null) => {
  switch (kind) {
    case 'edit':
      return t('permission.editFile')
    case 'delete':
      return t('permission.delete')
    case 'execute':
      return t('permission.runCommand')
    case 'move':
      return t('permission.moveFile')
    default:
      return t('permission.action')
  }
}

/** Label for the kind-scoped always-allow button. Names the breadth granted so
 *  the user sees they're allowing every action of this kind, not just the one
 *  command shown. */
const alwaysAllowKindLabel = (t: TFunction, kind?: string | null): string => {
  const label = toolKindLabel(t, kind)
  return label === t('permission.action')
    ? t('permission.alwaysAllowKindGeneric')
    : t('permission.alwaysAllowKind', { label })
}

const optionVariant = (kind: PermissionOption['kind']): 'default' | 'destructive' | 'outline' | 'secondary' => {
  switch (kind) {
    case 'allow_once':
      return 'default'
    case 'allow_always':
      return 'secondary'
    case 'reject_once':
      return 'outline'
    case 'reject_always':
      return 'destructive'
  }
}

/** Formats ACP raw tool input as complete plain text for informed approval. */
const formatToolInput = (input: unknown): string | undefined =>
  typeof input === 'string' ? input : JSON.stringify(input, null, 2)

/**
 * Inline permission prompt rendered above the prompt input when an ACP agent
 * issues a `requestPermission` for a tool call. The dialog disables itself
 * after the first selection so a fast double-click can't fire two responses.
 */
export const PermissionDialog = ({
  request,
  onRespond,
  onAlwaysAllowTool,
  onAlwaysAllowAgent,
}: PermissionDialogProps) => {
  const { t } = useTranslation('chat')
  const [responded, setResponded] = useState(false)

  const allowOption = findAllowOption(request.options)
  const toolCall = request.toolCall
  const title = toolCall?.title ?? t('permission.title')
  const kind = toolCall?.kind
  const toolInput = toolCall?.rawInput === undefined ? undefined : formatToolInput(toolCall.rawInput)

  const respondOnce = (respond: () => void) => {
    if (responded) {
      return
    }
    setResponded(true)
    respond()
  }

  const handleSelect = (option: PermissionOption) =>
    respondOnce(() =>
      onRespond({
        outcome: { outcome: 'selected', optionId: option.optionId },
      }),
    )

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 my-2" role="dialog">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-amber-500" />
        <span className="font-medium text-[length:var(--font-size-body)]">{toolKindLabel(t, kind)}</span>
      </div>

      <p className="text-[length:var(--font-size-sm)] text-muted-foreground">{title}</p>

      {toolInput !== undefined && (
        <div className="flex flex-col gap-1">
          <p className="text-[length:var(--font-size-xs)] text-muted-foreground">{t('permission.commandArgs')}</p>
          <pre
            aria-label={t('permission.toolInput')}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-[length:var(--font-size-xs)]"
          >
            {toolInput}
          </pre>
        </div>
      )}

      {toolCall?.locations && toolCall.locations.length > 0 && (
        <div className="text-[length:var(--font-size-xs)] text-muted-foreground font-mono">
          {toolCall.locations.map((loc, i) => (
            <div key={i}>
              {loc.path}
              {loc.line != null && `:${loc.line}`}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {request.options.map((option) => (
          <Button
            key={option.optionId}
            variant={optionVariant(option.kind)}
            size="sm"
            disabled={responded}
            onClick={() => handleSelect(option)}
          >
            {option.name}
          </Button>
        ))}
      </div>

      {allowOption && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" disabled={responded} onClick={() => respondOnce(onAlwaysAllowTool)}>
            {alwaysAllowKindLabel(t, kind)}
          </Button>
          <Button variant="ghost" size="sm" disabled={responded} onClick={() => respondOnce(onAlwaysAllowAgent)}>
            {t('permission.alwaysAllowEverything')}
          </Button>
        </div>
      )}
    </div>
  )
}
