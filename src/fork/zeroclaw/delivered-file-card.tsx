/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { FileCard } from '@/components/chat/file-card'
import { Button } from '@/components/ui/button'
import { useSideview } from '@/content-view/context'
import { getAttachment } from '@/lib/file-blob-storage'
import { buildDocumentSideviewId } from '@/types/citation'
import { Download } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isDeliveredFilesOutput, type DeliveredFileRef, type DeliveredFilesOutput } from './outbound-resource-blob'

type DeliveredFileCardProps = {
  output: unknown
}

const downloadRef = async (ref: DeliveredFileRef): Promise<void> => {
  const stored = await getAttachment(ref.localFileId)
  const blob = stored?.blob
  if (!blob) {
    return
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = ref.filename
  // The anchor MUST be in the DOM for a programmatic `.click()` to trigger a save in
  // Tauri's WebView (a detached anchor silently no-ops there), and the object URL is
  // revoked on the next macrotask — revoking synchronously cancels the download before
  // the webview streams the blob to disk. Mirrors lib/export-download.ts#downloadJson.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Preview/download UI for ACP `deliver_file` (and any tool_call_update that
 * carried standard `resource`+`blob` content). Opens the existing local-file
 * sideview for PDF/DOCX preview.
 */
export const DeliveredFileCard = ({ output }: DeliveredFileCardProps) => {
  const { showSideview } = useSideview()
  if (!isDeliveredFilesOutput(output)) {
    return null
  }
  return <DeliveredFilesList files={output.deliveredFiles} showLabel={!!output.text} showSideview={showSideview} />
}

/**
 * Render a set of delivered files as one wrapping row. Used to merge files that
 * arrived across several consecutive `deliver_file` tool calls into a single row
 * (see assistant-message) instead of a card per call stacked vertically.
 */
export const DeliveredFilesGroup = ({ files }: { files: DeliveredFileRef[] }) => {
  const { showSideview } = useSideview()
  if (files.length === 0) {
    return null
  }
  return <DeliveredFilesList files={files} showLabel showSideview={showSideview} />
}

type ListProps = {
  files: DeliveredFileRef[]
  showLabel: boolean
  showSideview: (sideviewType: string | null, sideviewId: string | null) => void
}

const DeliveredFilesList = ({ files, showLabel, showSideview }: ListProps) => {
  const { t } = useTranslation('chat')
  const open = useCallback(
    (ref: DeliveredFileRef) => {
      showSideview('local-file', buildDocumentSideviewId({ fileId: ref.localFileId, fileName: ref.filename }))
    },
    [showSideview],
  )

  return (
    <div className="my-2 flex flex-col gap-2">
      {showLabel ? <p className="text-sm text-muted-foreground">{t('deliveredFile.delivered')}</p> : null}
      <div className="flex flex-wrap gap-3">
        {files.map((ref) => (
          <div key={ref.localFileId} className="flex flex-col items-start gap-1">
            <FileCard
              localFileId={ref.localFileId}
              filename={ref.filename}
              mimeType={ref.mimeType}
              onOpen={() => open(ref)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={() => void downloadRef(ref)}
              aria-label={t('deliveredFile.downloadAria', { filename: ref.filename })}
            >
              <Download className="size-3.5" aria-hidden />
              {t('deliveredFile.download')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

export type { DeliveredFilesOutput }
