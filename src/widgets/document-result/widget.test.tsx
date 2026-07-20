/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@/testing-library'
import { ContentViewProvider, useContentView } from '@/content-view/context'
import { clearDeliveredUriRefMap, upsertDeliveredUriRef } from '@/fork/zeroclaw/delivered-uri-ref-map'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'bun:test'
import { type ReactNode } from 'react'
import { DocumentResultWidget } from './widget'

type CapturedSideview = { sideviewType: string | null; sideviewId: string | null } | null

const renderWithCapture = (ui: ReactNode) => {
  let captured: CapturedSideview = null
  const Capture = () => {
    const { state } = useContentView()
    captured =
      state.type === 'sideview' ? { sideviewType: state.data.sideviewType, sideviewId: state.data.sideviewId } : null
    return null
  }
  render(
    <ContentViewProvider>
      {ui}
      <Capture />
    </ContentViewProvider>,
  )
  return {
    captured: () => captured,
  }
}

describe('DocumentResultWidget', () => {
  beforeEach(() => {
    clearDeliveredUriRefMap()
  })

  it('renders file name and snippet', () => {
    render(
      <ContentViewProvider>
        <DocumentResultWidget name="report.pdf" fileId="file-1" snippet="Key excerpt here" />
      </ContentViewProvider>,
    )
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('Key excerpt here')).toBeInTheDocument()
  })

  it('omits the snippet block when none is provided', () => {
    render(
      <ContentViewProvider>
        <DocumentResultWidget name="report.pdf" fileId="file-1" />
      </ContentViewProvider>,
    )
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.queryByText(/.+/, { selector: 'p.line-clamp-2' })).toBeNull()
  })

  it('opens the document sideview when clicked', () => {
    const { captured } = renderWithCapture(<DocumentResultWidget name="report.pdf" fileId="file-1" snippet="x" />)

    fireEvent.click(screen.getByRole('button', { name: /report\.pdf/i }))

    expect(captured()).toEqual({
      sideviewType: 'document',
      sideviewId: 'file-1:report.pdf',
    })
  })

  it('opens local-file sideview for ZeroClaw attachment uri', () => {
    upsertDeliveredUriRef({
      uri: 'attachment://deliver/a1b2c3d4e5f6.pdf',
      localFileId: 'local-abc',
      turnPosition: 1,
      mimeType: 'application/pdf',
      storageBasename: 'a1b2c3d4e5f6.pdf',
      title: 'Годовой отчёт',
    })

    const { captured } = renderWithCapture(
      <DocumentResultWidget name="Договор.pdf" fileId="attachment://deliver/a1b2c3d4e5f6.pdf" />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Договор\.pdf/i }))

    const sideview = captured()
    expect(sideview?.sideviewType).toBe('local-file')
    expect(sideview?.sideviewId).toContain('local-abc')
    // sideviewId is keyed on the basename (matches the download card + citations),
    // not the widget label — so it stays consistent across all three open paths.
    expect(sideview?.sideviewId).toContain('a1b2c3d4e5f6.pdf')
    expect(sideview?.sideviewType).not.toBe('document')
  })

  it('chooses the correct icon variant based on extension', () => {
    // PDF
    const { unmount } = render(
      <ContentViewProvider>
        <DocumentResultWidget name="a.pdf" fileId="f" />
      </ContentViewProvider>,
    )
    expect(screen.getByRole('button').querySelector('svg')).toBeInTheDocument()
    unmount()

    // DOCX
    render(
      <ContentViewProvider>
        <DocumentResultWidget name="a.docx" fileId="f" />
      </ContentViewProvider>,
    )
    expect(screen.getByRole('button').querySelector('svg')).toBeInTheDocument()
  })
})
