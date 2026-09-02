/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import './docx-preview.css'

type DocxPreviewProps = {
  /** Object URL of the .docx blob (already resolved by the caller's blob hook). */
  blobUrl: string
  fileName: string
}

type RenderStatus = 'loading' | 'ready' | 'error'

/**
 * Renders a .docx as faithful, paginated Word-like pages (white sheets on a
 * themed canvas) via the `docx-preview` library.
 *
 * Replaces the upstream path (mammoth `convertToHtml` injected into a style-less
 * `sandbox=""` `srcDoc` iframe), which rendered as unstyled black-on-transparent
 * text — unreadable in dark mode — and had no pagination. `docx-preview` is
 * dynamically imported so it and its `jszip` dependency stay out of the PDF-only
 * code path and the entry bundle.
 *
 * Security note: unlike the upstream sandboxed iframe, `docx-preview` builds the
 * document into the app DOM. It does not execute scripts embedded in the file
 * (it maps OOXML to elements and resolves media as blob URLs); output is scoped
 * to the `.docx-viewer` container.
 */
export const DocxPreview = ({ blobUrl, fileName }: DocxPreviewProps) => {
  const { t } = useLingui()
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<RenderStatus>('loading')

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let cancelled = false
    let observer: ResizeObserver | null = null
    setStatus('loading')

    // Scale the rendered pages to fill the panel width — docx-preview lays pages
    // out at their true A4/Letter width, which overflows the narrow sideview.
    // `zoom` scales the layout box too (no leftover gap); recomputed on resize.
    const fitToWidth = () => {
      const wrapper = container.querySelector<HTMLElement>('.docx-wrapper')
      const page = container.querySelector<HTMLElement>('.docx-wrapper > section.docx')
      if (!wrapper || !page) {
        return
      }
      wrapper.style.zoom = '1'
      const pageWidth = page.offsetWidth
      const available = container.clientWidth
      if (pageWidth > 0 && available > 0) {
        wrapper.style.zoom = String(available / pageWidth)
      }
    }

    const render = async () => {
      try {
        const [blob, { renderAsync }] = await Promise.all([
          fetch(blobUrl).then((res) => res.blob()),
          import('docx-preview'),
        ])
        if (cancelled) {
          return
        }
        container.replaceChildren()
        await renderAsync(blob, container, undefined, {
          className: 'docx',
          inWrapper: true,
          // Honor Word's rendered page breaks so the document splits into
          // separate sheets instead of one continuous page.
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
        })
        if (cancelled) {
          return
        }
        fitToWidth()
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(fitToWidth)
          observer.observe(container)
        }
        setStatus('ready')
      } catch {
        if (!cancelled) {
          setStatus('error')
        }
      }
    }

    void render()

    return () => {
      cancelled = true
      observer?.disconnect()
      container.replaceChildren()
    }
  }, [blobUrl])

  return (
    <div className="relative min-h-full w-full bg-muted">
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center px-4">
          <p className="text-center text-sm text-destructive">
            {t`Could not render ${fileName}. Use the download button to open it.`}
          </p>
        </div>
      )}
      <div ref={containerRef} className="docx-viewer" />
    </div>
  )
}
