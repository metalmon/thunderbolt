/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon). See ./file-chip.tsx. */

import '@/testing-library'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { FileChip } from './file-chip'

describe('FileChip', () => {
  it('shows the filename', () => {
    render(<FileChip localFileId="f1" filename="quarterly-report.pdf" mimeType="application/pdf" />)
    expect(screen.getByText('quarterly-report.pdf')).toBeInTheDocument()
  })

  it('primary Open button invokes onOpen (side panel)', () => {
    const onOpen = mock(() => {})
    render(<FileChip localFileId="f1" filename="a.docx" mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" onOpen={onOpen} />)
    // The visible primary button (the dropdown item with the same label is portalled/closed).
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('disables Open when no side-panel handler is provided', () => {
    render(<FileChip localFileId="f1" filename="a.txt" mimeType="text/plain" />)
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
  })

  it('offers a resend control when remediation targets are given', () => {
    render(
      <FileChip
        localFileId="f1"
        filename="a.pdf"
        mimeType="application/pdf"
        deliverAs="text"
        resendTargets={['images']}
        onResend={() => {}}
      />,
    )
    expect(screen.getByText('Resend as images')).toBeInTheDocument()
    expect(screen.getByText('Sent as text')).toBeInTheDocument()
  })
})
