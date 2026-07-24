/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ContentViewHeader } from '@/content-view/header'
import { useContentView } from '@/content-view/context'
import { Button } from '@/components/ui/button'
import { useHttpClient } from '@/contexts'
import { Download, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { useDocumentBlob, useLocalDocumentBlob, type DocumentBlobState, type FileType } from './use-document-blob'

// Configure the pdfjs worker via Vite's `new URL(..., import.meta.url)` pattern
// so the worker ships as its own bundle and is resolved relative to the build.
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

/** Returns the supported file type for previewing, based on extension. */
export const getFileType = (fileName: string): FileType => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') {
    return 'pdf'
  }
  if (ext === 'docx') {
    return 'docx'
  }
  return 'unsupported'
}

type DocumentPreviewProps = {
  fileName: string
  fileType: FileType
  state: DocumentBlobState
  initialPage?: number
}

/**
 * Presentational document preview for the sideview slot: header + download,
 * react-pdf for PDFs, mammoth-rendered HTML (sandboxed iframe) for DOCX, and a
 * download fallback otherwise. Source-agnostic — the blob lifecycle is resolved
 * by the caller (Haystack-backed or local IndexedDB) and passed in as `state`.
 */
const DocumentPreview = ({ fileName, fileType, state, initialPage }: DocumentPreviewProps) => {
  const { t } = useTranslation('chat')
  const { close } = useContentView()
  const [numPages, setNumPages] = useState<number | null>(null)
  // Render each PDF page at the live width of the scroll container so the
  // document scales proportionally as the side panel is resized. `contentRect`
  // is the content box (padding already excluded), i.e. exactly the room a
  // page has. Callback ref + ResizeObserver (with React 19 ref cleanup) avoids
  // an effect and re-attaches automatically when the ready-state div mounts.
  const [pageWidth, setPageWidth] = useState<number | null>(null)
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return
    }
    // Coalesce the burst of callbacks fired while the panel opens (framer
    // animates its width frame-by-frame) or is dragged: committing the width on
    // every frame re-rasterises every react-pdf page and is what made resizing
    // janky. Debounce to the settled width so pages re-render once, at rest.
    let settle: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width)
      clearTimeout(settle)
      settle = setTimeout(() => setPageWidth(width), 120)
    })
    observer.observe(node)
    return () => {
      observer.disconnect()
      clearTimeout(settle)
    }
  }, [])

  const blobUrl = state.status === 'ready' ? state.blobUrl : null

  const handleDownload = useCallback(() => {
    if (!blobUrl) {
      return
    }
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [blobUrl, fileName])

  const onDocumentLoadSuccess = useCallback(({ numPages: pages }: { numPages: number }) => {
    setNumPages(pages)
  }, [])

  useEffect(() => {
    if (!initialPage || !numPages || initialPage > numPages) {
      return
    }
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-page-number="${initialPage}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
    return () => clearTimeout(timer)
  }, [initialPage, numPages])

  const downloadAction = (
    <Button
      onClick={handleDownload}
      disabled={!blobUrl}
      variant="ghost"
      size="icon"
      className="h-8 w-8 rounded-full"
      aria-label={t('documentPreview.downloadAria', { filename: fileName })}
    >
      <Download className="size-4" aria-hidden />
    </Button>
  )

  return (
    <div className="flex h-full flex-col">
      <ContentViewHeader title={fileName} onClose={close} actions={downloadAction} className="border-b border-border" />

      {state.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {state.status === 'error' && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-destructive">{state.message}</p>
        </div>
      )}

      {state.status === 'ready' && (
        <div ref={measureRef} className="flex-1 overflow-auto p-4">
          {fileType === 'pdf' && (
            <Document file={state.blobUrl} onLoadSuccess={onDocumentLoadSuccess} loading={null}>
              {numPages &&
                Array.from({ length: numPages }, (_, i) => (
                  <div key={i + 1} data-page-number={i + 1}>
                    <Page pageNumber={i + 1} width={pageWidth ?? 500} className="mb-4" />
                  </div>
                ))}
            </Document>
          )}

          {fileType === 'docx' && state.docxHtml && (
            <iframe
              title={fileName}
              className="prose prose-sm dark:prose-invert max-w-none w-full h-full border-0"
              sandbox=""
              srcDoc={state.docxHtml}
            />
          )}

          {fileType === 'unsupported' && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">{t('documentPreview.unavailable')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

type PdfSidebarViewerProps = {
  fileId: string
  fileName: string
  initialPage?: number
}

/** Preview a Haystack-managed document (fetched from the backend by file id). */
export const PdfSidebarViewer = ({ fileId, fileName, initialPage }: PdfSidebarViewerProps) => {
  const httpClient = useHttpClient()
  const fileType = getFileType(fileName)
  const state = useDocumentBlob(fileId, fileType, httpClient)
  return <DocumentPreview fileName={fileName} fileType={fileType} state={state} initialPage={initialPage} />
}

type LocalPdfSidebarViewerProps = {
  localFileId: string
  fileName: string
  initialPage?: number
}

/** Preview a locally-uploaded attachment (read from IndexedDB, never the backend). */
export const LocalPdfSidebarViewer = ({ localFileId, fileName, initialPage }: LocalPdfSidebarViewerProps) => {
  const fileType = getFileType(fileName)
  const state = useLocalDocumentBlob(localFileId, fileType)
  return <DocumentPreview fileName={fileName} fileType={fileType} state={state} initialPage={initialPage} />
}
