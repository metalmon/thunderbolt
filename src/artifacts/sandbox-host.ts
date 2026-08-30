/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Sandboxed-content host (platform-agnostic front end).
 *
 * Registers a self-contained HTML document to be served from a dedicated origin
 * that returns its OWN `Content-Security-Policy` header, and returns a URL to point
 * an iframe at. This is the ONE way to run agent-authored / MCP-app inline scripts
 * under the app's strict CSP: local-scheme iframes (`srcdoc`/`data:`/`blob:`) inherit
 * the embedder CSP in Chromium/WebView2 and their own `<meta>` CSP can't loosen it
 * (empirically confirmed), whereas a real cross-origin document is governed only by
 * its own response CSP.
 *
 * The content is still meant to be framed with `sandbox="allow-scripts"` (never
 * `allow-same-origin`) by the caller — opaque origin, no reach into the app — and the
 * per-item `csp` (e.g. render_html's offline `default-src 'none'; connect-src 'none'`)
 * blocks network exfiltration. Content-source-agnostic on purpose: render_html is the
 * first consumer; MCP apps will pass their own `csp`/content later.
 *
 * Two backends, one API, chosen at runtime:
 *  - Desktop (Tauri): store in Rust (`store_sandbox_content`), serve via the `sandbox:`
 *    URI-scheme protocol (see `src-tauri/src/sandbox.rs`). Fully offline.
 *  - Web: store in a service worker that answers `/__sandbox__/<id>` with the item's
 *    CSP header (see `public/sandbox-sw.js`). Offline, no backend.
 */
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/platform'

/** A document + the CSP to serve it under. `html` should already be fully wrapped
 *  (harness/meta) by the caller — the host only serves and sets the header. */
export type SandboxContent = { html: string; csp: string }

/** A live registration: the URL to point an iframe at, and a `revoke` to release it. */
export type SandboxHandle = { url: string; revoke: () => void }

// ── Desktop (Tauri) ────────────────────────────────────────────────────────────

const registerDesktop = async ({ html, csp }: SandboxContent): Promise<SandboxHandle> => {
  const id = crypto.randomUUID()
  await invoke('store_sandbox_content', { id, html, csp })
  // convertFileSrc builds the per-OS custom-scheme URL: `sandbox://localhost/<id>`
  // (macOS/Linux) or `http://sandbox.localhost/<id>` (Windows/WebView2).
  return {
    url: convertFileSrc(id, 'sandbox'),
    revoke: () => {
      void invoke('revoke_sandbox_content', { id })
    },
  }
}

// ── Web (service worker) ─────────────────────────────────────────────────────────

const SANDBOX_SW_URL = '/sandbox-sw.js'
const SANDBOX_PATH_PREFIX = '/__sandbox__/'
const SW_CHANNEL = 'sandbox-host'

let swReady: Promise<ServiceWorker> | null = null

/** Register (once) the sandbox service worker and resolve when it controls this page,
 *  so its `fetch` handler will intercept `/__sandbox__/<id>` navigations. */
const ensureSandboxSw = (): Promise<ServiceWorker> => {
  if (swReady) {
    return swReady
  }
  swReady = (async () => {
    if (!('serviceWorker' in navigator)) {
      throw new Error('Service workers are unavailable; cannot host sandboxed content on this platform.')
    }
    const registration = await navigator.serviceWorker.register(SANDBOX_SW_URL)
    await navigator.serviceWorker.ready
    // `clients.claim()` in the SW makes it control already-open pages; wait for that
    // so the very first artifact's fetch is intercepted rather than hitting the network.
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
      })
    }
    const worker = registration.active
    if (!worker) {
      throw new Error('Sandbox service worker registered but has no active instance.')
    }
    return worker
  })()
  return swReady
}

/** Round-trip a message to the SW and await its ack (via a private MessagePort). */
const postToSw = async (message: Record<string, unknown>): Promise<void> => {
  const worker = await ensureSandboxSw()
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = (event) => {
      if (event.data?.ok) {
        resolve()
      } else {
        reject(new Error('Sandbox service worker did not acknowledge.'))
      }
    }
    worker.postMessage({ channel: SW_CHANNEL, ...message }, [channel.port2])
  })
}

const registerWeb = async ({ html, csp }: SandboxContent): Promise<SandboxHandle> => {
  const id = crypto.randomUUID()
  await postToSw({ type: 'store', id, html, csp })
  return {
    url: `${SANDBOX_PATH_PREFIX}${id}`,
    revoke: () => {
      void postToSw({ type: 'revoke', id }).catch(() => {})
    },
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * Register HTML to be served from an own-CSP origin. Returns the iframe `url` and a
 * `revoke` to call when the frame unmounts or its content is replaced.
 */
export const registerSandboxContent = (content: SandboxContent): Promise<SandboxHandle> =>
  isTauri() ? registerDesktop(content) : registerWeb(content)
