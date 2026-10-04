/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@/testing-library'
import { getClock } from '@/testing-library'
import { ContentViewProvider } from '@/content-view/context'
import { resetAppSettledForTests } from '@/hooks/use-app-settled'
import type { ToolOrDynamicToolUIPart } from '@/lib/assistant-message'
import { mockIntersectionObserver } from '@/test-utils/mock-intersection-observer'
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { ArtifactMessagePart } from './artifact-message-part'

// The frame no longer renders synchronously: since the sandbox-host redesign its
// `src` comes from registering the document with the host (a Tauri IPC round-trip
// on desktop, a service worker on web), and neither exists under jsdom — so the
// component sits on its placeholder and no iframe is ever queried. Stand in for the
// host, and the registrations it receives become the thing worth asserting: the
// script gate now lives in the CSP we hand it, not in an iframe attribute (which
// desktop still sets and web deliberately omits).
const registrations: { html: string; csp: string }[] = []
mock.module('@/artifacts/sandbox-host', () => ({
  registerSandboxContent: async (content: { html: string; csp: string }) => {
    registrations.push(content)
    return { url: `sandbox://test/${registrations.length}`, revoke: () => {} }
  },
}))

/** Lets the registration promise resolve so the iframe is in the DOM. */
const settleFrame = async () => {
  await act(async () => {
    await Promise.resolve()
  })
}

type PartOverrides = {
  toolCallId: string
  state: string
  output?: unknown
  html?: string
  title?: string
}

const toolPart = (overrides: PartOverrides): ToolOrDynamicToolUIPart =>
  ({
    type: 'tool-render_html',
    toolCallId: overrides.toolCallId,
    state: overrides.state,
    input: { html: overrides.html ?? '<h1>Hi</h1>', title: overrides.title ?? 'My Artifact' },
    ...(overrides.output !== undefined ? { output: overrides.output } : {}),
  }) as unknown as ToolOrDynamicToolUIPart

const renderPart = (part: ToolOrDynamicToolUIPart) =>
  render(
    <ContentViewProvider>
      <ArtifactMessagePart part={part} />
    </ContentViewProvider>,
  )

describe('ArtifactMessagePart', () => {
  let restoreIntersectionObserver: () => void
  beforeEach(() => {
    restoreIntersectionObserver = mockIntersectionObserver(true)
    resetAppSettledForTests()
  })
  afterEach(() => {
    restoreIntersectionObserver()
    resetAppSettledForTests()
  })

  it('shows a shimmering "Generating" card while streaming, with no blank frame before there is body content', () => {
    const { container } = renderPart(toolPart({ toolCallId: 'a1', state: 'input-streaming', html: '' }))
    expect(container.textContent).toContain('Generating')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('reveals the live preview once the streaming HTML has body content', async () => {
    const { container } = renderPart(
      toolPart({ toolCallId: 'a1b', state: 'input-streaming', html: '<body><h1>Hi</h1></body>' }),
    )
    await settleFrame()
    expect(container.querySelector('iframe')).not.toBeNull()
    // Scripts off during the preview — asserted where the gate now lives.
    expect(registrations.at(-1)?.csp).toContain('sandbox')
    expect(registrations.at(-1)?.csp).not.toContain('allow-scripts')
  })

  it('renders a verified inline artifact, running scripts once visible + settled', async () => {
    const { container } = renderPart(toolPart({ toolCallId: 'a2', state: 'output-available', output: { ok: true } }))
    await settleFrame()
    expect(registrations.at(-1)?.csp).not.toContain('allow-scripts')
    await act(async () => {
      await getClock().tickAsync(1000)
    })
    await settleFrame()
    // Re-registered with scripts enabled once the artifact is visible and settled.
    expect(registrations.at(-1)?.csp).toContain('allow-scripts')
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(container.textContent).toContain('My Artifact')
  })

  it('toggles between inline and the side panel — never both at once', async () => {
    const { container, getByTitle, getByText } = renderPart(
      toolPart({ toolCallId: 'a3', state: 'output-available', output: { ok: true } }),
    )
    await settleFrame()
    expect(container.querySelector('iframe')).not.toBeNull()

    // Open in the side panel → the transcript collapses to a slim placeholder (no iframe).
    act(() => {
      fireEvent.click(getByTitle('Open in side panel'))
    })
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('shown in side panel')

    // Show inline → the iframe returns, once it has re-registered with the host.
    act(() => {
      fireEvent.click(getByText('Show inline'))
    })
    await settleFrame()
    expect(container.querySelector('iframe')).not.toBeNull()
  })

  it('collapses to just the header when the header is clicked (open by default)', () => {
    const { container } = renderPart(toolPart({ toolCallId: 'a5', state: 'output-available', output: { ok: true } }))
    const header = container.querySelector('[aria-expanded]')
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    act(() => {
      fireEvent.click(header as Element)
    })
    expect(header?.getAttribute('aria-expanded')).toBe('false')
  })

  it('leaves the header inert while generating (no collapse affordance)', () => {
    const { container } = renderPart(
      toolPart({ toolCallId: 'a6', state: 'input-streaming', html: '<body><h1>Hi</h1></body>' }),
    )
    expect(container.querySelector('[aria-expanded]')).toBeNull()
    expect(container.querySelector('[role="button"]')).toBeNull()
  })

  it('exposes copy + download actions once verified, but not while generating', () => {
    const streaming = renderPart(
      toolPart({ toolCallId: 'a7', state: 'input-streaming', html: '<body><h1>Hi</h1></body>' }),
    )
    expect(streaming.queryByTitle('Copy HTML')).toBeNull()
    expect(streaming.queryByTitle('Download HTML')).toBeNull()

    const done = renderPart(toolPart({ toolCallId: 'a7b', state: 'output-available', output: { ok: true } }))
    expect(done.getByTitle('Copy HTML')).not.toBeNull()
    expect(done.getByTitle('Download HTML')).not.toBeNull()
  })

  it('renders nothing for a failed verification (it stays an ordinary tool call elsewhere)', () => {
    const { container } = renderPart(
      toolPart({ toolCallId: 'a4', state: 'output-available', output: { ok: false, errors: ['boom'] } }),
    )
    expect(container.textContent).toBe('')
  })
})
