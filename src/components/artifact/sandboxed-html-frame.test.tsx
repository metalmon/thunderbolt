/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@/testing-library'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'

/** Flush the mocked host promise + the resulting React re-render (no fake timers —
 *  this project's testing-library config disables waitFor's timer path). */
const settle = () => act(async () => await Promise.resolve())

// The frame now serves its content from the sandboxed-content host (own-CSP origin)
// instead of `srcdoc`. Mock the host to capture what gets served and hand back a URL.
let lastRegistered: { html: string; csp: string } | null = null
mock.module('@/artifacts/sandbox-host', () => ({
  registerSandboxContent: (content: { html: string; csp: string }) => {
    lastRegistered = content
    return Promise.resolve({ url: 'sandbox://localhost/test-id', revoke: () => {} })
  },
}))

import { SandboxedHtmlFrame } from './sandboxed-html-frame'

afterEach(() => {
  lastRegistered = null
})

describe('SandboxedHtmlFrame', () => {
  it('serves the html + harness from the sandbox host and frames it script-sandboxed', async () => {
    const { container } = render(<SandboxedHtmlFrame html="<h1>Chart</h1>" title="My chart" />)
    await settle()
    const iframe = container.querySelector('iframe')!
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('title')).toBe('My chart')
    // Loaded from the host URL, not srcdoc (which would inherit the app CSP).
    expect(iframe.getAttribute('src')).toBe('sandbox://localhost/test-id')
    expect(iframe.getAttribute('srcdoc')).toBeNull()
    // What we served carries the agent html plus the error/ready harness.
    expect(lastRegistered?.html).toContain('<h1>Chart</h1>')
    expect(lastRegistered?.html).toContain('postMessage')
    expect(lastRegistered?.csp).toContain("default-src 'none'")
  })

  it('never grants same-origin access to the sandboxed content', async () => {
    const { container } = render(<SandboxedHtmlFrame html="<p>x</p>" title="t" />)
    await settle()
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('serves the offline CSP but no harness when scripts are disabled (streaming preview)', async () => {
    const { container } = render(<SandboxedHtmlFrame html="<p>partial</p>" title="t" allowScripts={false} />)
    await settle()
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('')
    expect(lastRegistered?.html).toContain('<p>partial</p>')
    expect(lastRegistered?.html).toContain('Content-Security-Policy') // preview is still offline
    expect(lastRegistered?.html).not.toContain('postMessage') // but no harness — scripts are off
  })
})
