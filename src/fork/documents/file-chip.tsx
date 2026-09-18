/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import { ChevronDown, Download, ExternalLink, File, FileSpreadsheet, FileText, PanelRight } from 'lucide-react'
import type { MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import type { ComponentType } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { canOpenNatively, downloadAndOpenNatively, downloadStoredFile } from './file-actions'

/** Alternative delivery modes a remediated file can be resent as. */
const resendAsLabel: Record<'text' | 'images', MessageDescriptor> = {
  text: msg`Resend as text`,
  images: msg`Resend as images`,
}

const deliverAsLabel: Record<'text' | 'images', MessageDescriptor> = {
  text: msg`Sent as text`,
  images: msg`Sent as images`,
}

type FileChipProps = {
  localFileId: string
  filename: string
  mimeType: string
  /** Open the file in the side panel (the default action). */
  onOpen?: () => void
  /** Non-native delivery mode applied by remediation — shown as a small badge. */
  deliverAs?: 'text' | 'images'
  /** Alternative delivery modes this file can be resent as. */
  resendTargets?: readonly ('text' | 'images')[]
  /** Re-deliver this file as the chosen mode and re-run the turn. */
  onResend?: (target: 'text' | 'images') => void
}

/** Short type badge from the extension, falling back to the mime type. */
const typeBadge = (filename: string, mimeType: string): string => {
  const ext = filename.includes('.') ? filename.split('.').pop()?.toUpperCase() : undefined
  if (ext && ext.length > 0 && ext.length <= 4) {
    return ext
  }
  return mimeType === 'application/pdf' ? 'PDF' : 'FILE'
}

/** Document-type lucide icon by mime / extension. */
const iconFor = (filename: string, mimeType: string): ComponentType<{ className?: string }> => {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (mimeType.includes('spreadsheet') || ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
    return FileSpreadsheet
  }
  if (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.includes('word') ||
    ['pdf', 'doc', 'docx', 'md', 'markdown', 'txt', 'rtf'].includes(ext ?? '')
  ) {
    return FileText
  }
  return File
}

/**
 * Claude-Desktop-style compact document card: a type icon + filename with a split
 * "Open" button — primary click opens the file in the side panel, the caret opens a
 * menu (Open · Download · Download and open natively). Replaces the large,
 * unreadable first-page thumbnail for documents (images keep their thumbnail).
 */
export const FileChip = ({ localFileId, filename, mimeType, onOpen, deliverAs, resendTargets, onResend }: FileChipProps) => {
  const { t, i18n } = useLingui()
  const Icon = iconFor(filename, mimeType)

  return (
    <div className="my-1 flex max-w-full flex-col items-start gap-1">
      <div className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border bg-card/50 py-1.5 pl-3 pr-1.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[length:var(--font-size-xs)] font-semibold text-muted-foreground">
          {typeBadge(filename, mimeType)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[length:var(--font-size-sm)]" title={filename}>
          {filename}
        </span>
        {deliverAs ? (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-[length:var(--font-size-xs)] text-muted-foreground">
            {i18n._(deliverAsLabel[deliverAs])}
          </span>
        ) : null}

        {/* Split button: primary Open (side panel) + a caret for the rest. */}
        <div className="ml-1 flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 rounded-r-none px-2"
            onClick={onOpen}
            disabled={!onOpen}
          >
            <PanelRight className="size-3.5" aria-hidden />
            {t`Open`}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-l-none border-l border-border px-1"
                aria-label={t`More actions for ${filename}`}
              >
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onOpen ? (
                <DropdownMenuItem onClick={onOpen}>
                  <PanelRight className="size-4" aria-hidden />
                  {t`Open`}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => void downloadStoredFile(localFileId, filename)}>
                <Download className="size-4" aria-hidden />
                {t`Download`}
              </DropdownMenuItem>
              {canOpenNatively() ? (
                <DropdownMenuItem onClick={() => void downloadAndOpenNatively(localFileId, filename)}>
                  <ExternalLink className="size-4" aria-hidden />
                  {t`Download and open`}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {onResend && resendTargets && resendTargets.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 pl-1">
          {resendTargets.map((target) => (
            <button
              key={target}
              type="button"
              onClick={() => onResend(target)}
              className="cursor-pointer rounded-md px-1.5 py-0.5 text-[length:var(--font-size-xs)] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {i18n._(resendAsLabel[target])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
