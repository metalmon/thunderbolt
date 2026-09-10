/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* src/fork/zeroclaw/ui-resource-chip.test.tsx */
import '@/testing-library'
import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { ContentViewProvider, useContentView } from '@/content-view/context'
import { CanvasRegistryProvider } from './canvas-registry'
import { UiResourceChip } from './ui-resource-chip'

const uiPart = (toolCallId: string, uri: string, html: string) =>
  ({
    type: 'tool-canvas',
    toolCallId,
    state: 'output-available',
    output: { uiResource: { uri, mimeType: 'text/html', html } },
  }) as never

const OpenState = () => {
  const { state } = useContentView()
  return <div data-testid="open">{state.type === 'artifact' ? state.data.title : 'none'}</div>
}

// Exposes close()/showSideview() as clickable buttons so tests can drive the
// panel imperatively, the way real UI (close button, a sideview link) would.
const ContentViewProbe = () => {
  const { close, showSideview } = useContentView()
  return (
    <>
      <button data-testid="close-panel" onClick={close}>
        close
      </button>
      <button data-testid="switch-sideview" onClick={() => showSideview('document', 'x')}>
        sideview
      </button>
    </>
  )
}

const Harness = ({ parts }: { parts: unknown[] }) => (
  <ContentViewProvider>
    <CanvasRegistryProvider messages={[{ id: 'm', role: 'assistant', parts } as never]}>
      {parts.map((p, i) => (
        <UiResourceChip key={i} part={p as never} />
      ))}
      <OpenState />
      <ContentViewProbe />
    </CanvasRegistryProvider>
  </ContentViewProvider>
)

describe('UiResourceChip', () => {
  it('auto-opens the artifact in the free panel on first emit', () => {
    render(<Harness parts={[uiPart('a', 'ui://pnl/dashboard', '<title>PnL</title>')]} />)
    expect(screen.getByTestId('open').textContent).toBe('PnL')
  })

  it('renders only one live chip; the older emit is superseded', () => {
    render(<Harness parts={[uiPart('a', 'ui://pnl/x', '<h1>Old</h1>'), uiPart('b', 'ui://pnl/x', '<h1>New</h1>')]} />)
    expect(screen.getAllByText(/superseded/i)).toHaveLength(1)
  })

  it('a later emit after a genuine close shows "updated" and does not auto-reopen', () => {
    const { rerender } = render(<Harness parts={[uiPart('a', 'ui://pnl/y', '<title>Y1</title>')]} />)
    // First emit auto-opened into the free panel.
    expect(screen.getByTestId('open').textContent).toBe('Y1')

    // Genuine close: artifact -> null.
    fireEvent.click(screen.getByTestId('close-panel'))
    expect(screen.getByTestId('open').textContent).toBe('none')

    // A new emit of the SAME uri (new toolCallId) lands while the panel is closed.
    rerender(<Harness parts={[uiPart('c', 'ui://pnl/y', '<title>Y2</title>')]} />)

    // The panel must not auto-reopen...
    expect(screen.getByTestId('open').textContent).toBe('none')
    // ...and the latest chip must report "updated".
    expect(screen.getByText(/updated/i)).toBeTruthy()
  })

  it('switching to a sideview is not a genuine close; a later emit stays non-"updated"', () => {
    const { rerender } = render(<Harness parts={[uiPart('a', 'ui://pnl/z', '<title>Z1</title>')]} />)
    expect(screen.getByTestId('open').textContent).toBe('Z1')

    // Switch the panel to a sideview (artifact -> sideview is a switch, not a close).
    fireEvent.click(screen.getByTestId('switch-sideview'))
    expect(screen.getByTestId('open').textContent).toBe('none')

    rerender(<Harness parts={[uiPart('d', 'ui://pnl/z', '<title>Z2</title>')]} />)

    expect(screen.queryByText(/updated/i)).toBeNull()
  })
})
