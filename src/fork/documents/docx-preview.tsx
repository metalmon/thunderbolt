/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useLingui } from '@lingui/react/macro'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type DocxPreviewProps = {
  /** Object URL of the .docx blob (already resolved by the caller's blob hook). */
  blobUrl: string
  fileName: string
}

type RenderStatus = 'loading' | 'ready' | 'error'

type Frame = { srcDoc: string; pageWidth: number }

/** Letter at 96dpi — the fallback when the document declares no page width. */
const defaultPageWidthPx = 816

/** CSS absolute units in px, at the 96dpi the browser defines them against. */
const pxPerUnit: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
}

/**
 * The declared page width in PIXELS.
 *
 * ⚠ docx-preview writes this width in POINTS (`595.3pt` for A4) because that is
 * what the OOXML twips convert to. Reading it with a bare `parseFloat` takes
 * 595.3 as pixels, so the fit scale comes out 96/72 — a third — too large and
 * the page hangs off the right edge of the panel with a scrollbar under it.
 * That is what shipped; the unit is not decoration.
 *
 * @param declared - the inline `width` docx-preview put on `section.docx`
 * @returns the width in px, or the Letter fallback when it is unreadable
 */
export const declaredPageWidthPx = (declared: string | undefined): number => {
  const match = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/i.exec(declared ?? '')
  const value = Number.parseFloat(match?.[1] ?? '')
  if (!Number.isFinite(value) || value <= 0) {
    return defaultPageWidthPx
  }
  const unit = (match?.[2] ?? '').toLowerCase()
  // An unknown unit is likelier to be a new spelling of a length than a signal
  // to fall back to Letter, so treat it as the px CSS would without a unit.
  return value * (pxPerUnit[unit] ?? 1)
}

/**
 * The frame's own stylesheet. It cannot read the app's theme tokens (different,
 * opaque origin), and it does not need to: a document reads as a white sheet in
 * any theme, like Word, Acrobat or Google Docs. The themed canvas around the
 * sheets lives on the host element, outside the frame.
 *
 * docx-preview hardcodes a gray `.docx-wrapper` background and its own padding;
 * both are neutralized here.
 */
const frameStylesheet = `
  html, body { margin: 0; padding: 0; background: transparent; }
  .docx-wrapper { background: transparent; padding: 0; }
  .docx-wrapper > section.docx { margin: 0 auto 1rem; box-shadow: 0 2px 10px rgb(0 0 0 / 0.18); }
`

/**
 * Renders a .docx as faithful, paginated Word-like pages (white sheets on a
 * themed canvas) via the `docx-preview` library, inside a sandboxed frame.
 *
 * Upstream renders DOCX as mammoth HTML in a `sandbox=""` `srcDoc` iframe, which
 * came out unstyled black-on-transparent (unreadable in dark mode) and had no
 * pagination. The fork swapped the library — and, for a while, also the frame:
 * docx-preview built the document straight into the app DOM. That is what this
 * version puts back, keeping the pagination.
 *
 * **Why the frame matters.** The document is untrusted input: it arrives as an
 * attachment or from an agent. docx-preview does not execute scripts from the
 * file (OOXML has none to map), but it does build real `<a href>` elements from
 * the document's hyperlinks — and a `javascript:` link clicked in the app origin
 * runs in the origin that holds the Tauri IPC. The empty `sandbox` closes that:
 * no scripts, an opaque origin, no form submission, no top-level navigation. The
 * parent's CSP is inherited by a `srcdoc` document too, so inline script is
 * refused twice over.
 *
 * Two consequences worth knowing:
 * - Images must be `data:` URIs (`useBase64URL`). docx-preview's default blob:
 *   URLs belong to the parent origin and an opaque origin cannot load them.
 * - Fitting pages to the panel is done from out here, by scaling the frame
 *   element: inside it there is no script to recompute anything on resize.
 *
 * `docx-preview` is dynamically imported so it and its `jszip` dependency stay
 * out of the PDF-only code path and the entry bundle.
 */
export const DocxPreview = ({ blobUrl, fileName }: DocxPreviewProps) => {
  const { t } = useLingui()
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<RenderStatus>('loading')
  const [frame, setFrame] = useState<Frame | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setFrame(null)

    const render = async () => {
      try {
        const [blob, { renderAsync }] = await Promise.all([
          fetch(blobUrl).then((res) => res.blob()),
          import('docx-preview'),
        ])
        if (cancelled) {
          return
        }
        // Built in a document of its own, never attached: nothing from the file
        // touches the app DOM, and the result is handed over as markup.
        const detached = document.implementation.createHTMLDocument(fileName)
        await renderAsync(blob, detached.body, undefined, {
          className: 'docx',
          inWrapper: true,
          // Honor Word's rendered page breaks so the document splits into
          // separate sheets instead of one continuous page.
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          // See the component comment: blob: URLs are unreachable from the
          // frame's opaque origin, data: URIs are not.
          useBase64URL: true,
        })
        if (cancelled) {
          return
        }
        const style = detached.createElement('style')
        style.textContent = frameStylesheet
        detached.head.append(style)

        // The declared page width, read off the inline style docx-preview writes
        // (no layout needed, which a detached document could not give anyway).
        const declared = detached.querySelector<HTMLElement>('section.docx')?.style.width
        const pageWidth = declaredPageWidthPx(declared)

        setFrame({ srcDoc: `<!doctype html><html>${detached.documentElement.innerHTML}</html>`, pageWidth })
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
    }
  }, [blobUrl, fileName])

  // Fit the pages to the panel. docx-preview lays them out at their true
  // A4/Letter width, which overflows the narrow sideview; the frame is scaled as
  // a whole and its logical height divided back out, so the scaled box still
  // fills the host and the frame keeps its own scrollbar.
  useEffect(() => {
    const host = hostRef.current
    const el = frameRef.current
    if (!host || !el || !frame) {
      return
    }
    const fit = () => {
      const available = host.clientWidth
      const scale = available > 0 ? available / frame.pageWidth : 1
      el.style.width = `${frame.pageWidth}px`
      el.style.height = `${100 / scale}%`
      el.style.transform = `scale(${scale})`
      el.style.transformOrigin = 'top left'
    }
    fit()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    return () => observer.disconnect()
  }, [frame])

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-muted">
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
      {frame && (
        <iframe
          ref={frameRef}
          title={fileName}
          /* Empty on purpose: the document needs no script, no origin, no form
           * and no navigation. Anything added here hands a capability to a file
           * the user merely received. */
          sandbox=""
          srcDoc={frame.srcDoc}
          className="block border-0"
        />
      )}
    </div>
  )
}
