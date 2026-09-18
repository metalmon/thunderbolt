/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). New file — do not upstream. */

import {
  ChevronDown,
  Download,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  PanelRight,
  Presentation,
} from 'lucide-react'
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
  /** Non-native delivery mode applied by remediation — shown as a small note. */
  deliverAs?: 'text' | 'images'
  /** Alternative delivery modes this file can be resent as. */
  resendTargets?: readonly ('text' | 'images')[]
  /** Re-deliver this file as the chosen mode and re-run the turn. */
  onResend?: (target: 'text' | 'images') => void
}

/**
 * Document-type icon + accent colour by mime / extension — a light Claude-Desktop
 * touch: the chip stays neutral like the canvas chip, only the type icon is tinted
 * (Word blue, Excel green, PowerPoint orange, PDF red, image teal).
 */
const iconFor = (filename: string, mimeType: string): { Icon: ComponentType<{ className?: string }>; color: string } => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (mimeType.startsWith('image/')) {
    return { Icon: FileImage, color: 'text-teal-600 dark:text-teal-400' }
  }
  if (mimeType.includes('spreadsheet') || ['csv', 'xlsx', 'xls'].includes(ext)) {
    return { Icon: FileSpreadsheet, color: 'text-green-700 dark:text-green-500' }
  }
  if (mimeType.includes('presentation') || ['ppt', 'pptx'].includes(ext)) {
    return { Icon: Presentation, color: 'text-orange-600 dark:text-orange-400' }
  }
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return { Icon: FileText, color: 'text-red-600 dark:text-red-400' }
  }
  if (mimeType.includes('word') || ['doc', 'docx', 'rtf'].includes(ext)) {
    return { Icon: FileText, color: 'text-blue-700 dark:text-blue-400' }
  }
  if (mimeType.startsWith('text/') || ['md', 'markdown', 'txt'].includes(ext)) {
    return { Icon: FileText, color: 'text-muted-foreground' }
  }
  return { Icon: File, color: 'text-muted-foreground' }
}

/**
 * Compact document card, styled to match the canvas `UiResourceChip` (same dashed
 * card, sizing and type scale): a type icon + filename + an "Open" button with a
 * caret menu (Open · Download · Download and open natively). Replaces the large,
 * unreadable first-page thumbnail for documents; images keep their thumbnail.
 */
/** Run a file action, surfacing (not swallowing) any failure. */
const run = (action: Promise<unknown>): void => {
  void action.catch((error) => console.error('File action failed', error))
}

export const FileChip = ({ localFileId, filename, mimeType, onOpen, deliverAs, resendTargets, onResend }: FileChipProps) => {
  const { t, i18n } = useLingui()
  const { Icon, color } = iconFor(filename, mimeType)

  return (
    <div className="my-2 flex w-full flex-col items-stretch gap-1">
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-3 py-2">
        <Icon className={`size-4 shrink-0 ${color}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={filename}>
          {filename}
        </span>
        {deliverAs ? (
          <span className="shrink-0 text-xs text-muted-foreground/70">{i18n._(deliverAsLabel[deliverAs])}</span>
        ) : null}
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="sm" className="h-7" onClick={onOpen} disabled={!onOpen}>
            {t`Open`}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-1" aria-label={t`More actions for ${filename}`}>
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
              <DropdownMenuItem onClick={() => run(downloadStoredFile(localFileId, filename))}>
                <Download className="size-4" aria-hidden />
                {t`Download`}
              </DropdownMenuItem>
              {canOpenNatively() ? (
                <DropdownMenuItem onClick={() => run(downloadAndOpenNatively(localFileId, filename))}>
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
              className="cursor-pointer rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {i18n._(resendAsLabel[target])}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
