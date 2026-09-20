/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import '@/testing-library'
import * as realThemeTokens from '@/artifacts/theme-tokens'
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

// Spy on the one DOM-touching seam the theme-injection observer calls, so the "only
// react when the resolved theme class actually changed" guard is verifiable directly —
// asserting on `registerSandboxContent` call counts alone can't distinguish "guard
// skipped the recompute" from "recompute ran but produced the identical string", since
// an unrelated class mutation (e.g. adding a scroll-lock class) leaves the resolved
// light/dark/paper class, and therefore the recomputed style, unchanged either way.
//
// Capture the real implementation into a plain variable BEFORE calling `mock.module`:
// `realThemeTokens.snapshotThemeTokens` is a live ES-module binding, so referencing it
// *inside* the mock factory (instead of copying it out first) would resolve to the
// mock's own replacement at call time and recurse into itself infinitely.
const realSnapshotThemeTokens = realThemeTokens.snapshotThemeTokens
let snapshotThemeTokensCallCount = 0
mock.module('@/artifacts/theme-tokens', () => ({
  ...realThemeTokens,
  snapshotThemeTokens: () => {
    snapshotThemeTokensCallCount += 1
    return realSnapshotThemeTokens()
  },
}))

import { SandboxedHtmlFrame } from './sandboxed-html-frame'

afterEach(() => {
  lastRegistered = null
  snapshotThemeTokensCallCount = 0
})

describe('SandboxedHtmlFrame', () => {
  it('serves the html + harness from the sandbox host and frames it script-sandboxed', async () => {
    const { container } = render(<SandboxedHtmlFrame html="<h1>Chart</h1>" title="My chart" />)
    await settle()
    const iframe = container.querySelector('iframe')!
    // Web build (isTauri() is false under test): NO `sandbox` attribute, so the
    // service worker intercepts the navigation; the opaque origin comes from the
    // CSP `sandbox allow-scripts` directive in the served header instead.
    expect(iframe.getAttribute('sandbox')).toBeNull()
    expect(iframe.getAttribute('title')).toBe('My chart')
    // Loaded from the host URL, not srcdoc (which would inherit the app CSP).
    expect(iframe.getAttribute('src')).toBe('sandbox://localhost/test-id')
    expect(iframe.getAttribute('srcdoc')).toBeNull()
    // What we served carries the agent html plus the error/ready harness.
    expect(lastRegistered?.html).toContain('<h1>Chart</h1>')
    expect(lastRegistered?.html).toContain('postMessage')
    expect(lastRegistered?.csp).toContain("default-src 'none'")
    // Isolation invariant (web): the served CSP always carries the sandbox directive,
    // so artifact HTML can never be served unsandboxed even without the attribute.
    expect(lastRegistered?.csp).toContain('sandbox allow-scripts')
  })

  it('never grants same-origin access to the sandboxed content', async () => {
    const { container } = render(<SandboxedHtmlFrame html="<p>x</p>" title="t" />)
    await settle()
    // Web: isolation is the CSP `sandbox` directive, never `allow-same-origin`.
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBeNull()
    expect(lastRegistered?.csp).toContain('sandbox')
    expect(lastRegistered?.csp).not.toContain('allow-same-origin')
  })

  it('serves the offline CSP but no harness when scripts are disabled (streaming preview)', async () => {
    const { container } = render(<SandboxedHtmlFrame html="<p>partial</p>" title="t" allowScripts={false} />)
    await settle()
    // Preview (web): no attribute; CSP is a bare `sandbox` (no allow-scripts).
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBeNull()
    expect(lastRegistered?.csp).toContain('sandbox;')
    expect(lastRegistered?.csp).not.toContain('allow-scripts')
    expect(lastRegistered?.html).toContain('<p>partial</p>')
    expect(lastRegistered?.html).toContain('Content-Security-Policy') // preview is still offline
    expect(lastRegistered?.html).not.toContain('postMessage') // but no harness — scripts are off
  })

  describe('theme re-wrap on toggle (spec §6)', () => {
    afterEach(() => {
      document.documentElement.classList.remove('light', 'dark', 'paper')
    })

    it('re-registers with a matching color-scheme when the resolved theme class changes', async () => {
      document.documentElement.classList.add('light')
      render(<SandboxedHtmlFrame html="<p>x</p>" title="t" />)
      await settle()
      expect(lastRegistered?.html).toContain('color-scheme: light;')

      document.documentElement.classList.remove('light')
      document.documentElement.classList.add('dark')
      // MutationObserver callbacks land as a microtask; flush it the same way `settle`
      // flushes the mocked host promise.
      await settle()

      expect(lastRegistered?.html).toContain('color-scheme: dark;')
    })

    it('does not re-snapshot when an unrelated documentElement class changes (scroll-lock, RTL, ...)', async () => {
      document.documentElement.classList.add('light')
      render(<SandboxedHtmlFrame html="<p>x</p>" title="t" />)
      await settle()
      const snapshotsAfterMount = snapshotThemeTokensCallCount
      expect(snapshotsAfterMount).toBeGreaterThan(0) // sanity: mounting does snapshot once

      document.documentElement.classList.add('scroll-locked')
      await settle()

      // The MutationObserver still fires (the attribute did mutate), but the resolved
      // light/dark/paper class is unchanged, so the guard must bail before re-snapshotting.
      expect(snapshotThemeTokensCallCount).toBe(snapshotsAfterMount)
    })
  })
})
