/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sandboxed-content service worker (web half of the host; desktop uses the Tauri
// `sandbox:` protocol instead — see src-tauri/src/sandbox.rs and src/artifacts/
// sandbox-host.ts). It serves agent / MCP-app HTML at `/__sandbox__/<id>` with the
// item's OWN Content-Security-Policy response header, so the framed document is
// governed by that per-item CSP and NOT by the app page's strict CSP (a real
// network response escapes the local-scheme CSP inheritance that blocks srcdoc/
// data:/blob:). The page still frames it with `sandbox="allow-scripts"` (opaque
// origin), so it can't reach the app; the per-item CSP blocks network exfiltration.
//
// Registered only on the web build; loaded as a plain file from /public so no
// bundler transform applies.

const PREFIX = '/__sandbox__/'
const CHANNEL = 'sandbox-host'

// id -> { html, csp }. In-memory: the page stores an item and AWAITS the ack before
// navigating the iframe, so the entry is always present for that immediate fetch.
const store = new Map()

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Control already-open pages immediately so the first artifact's fetch is intercepted.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || msg.channel !== CHANNEL) {
    return
  }
  const reply = event.ports && event.ports[0]
  if (msg.type === 'store') {
    store.set(msg.id, { html: msg.html, csp: msg.csp })
    if (reply) reply.postMessage({ ok: true })
  } else if (msg.type === 'revoke') {
    store.delete(msg.id)
    if (reply) reply.postMessage({ ok: true })
  } else if (reply) {
    reply.postMessage({ ok: false })
  }
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) {
    return // let everything else hit the network / cache normally
  }
  const id = url.pathname.slice(PREFIX.length)
  const item = store.get(id)
  if (!item) {
    event.respondWith(new Response('sandbox content not found', { status: 404 }))
    return
  }
  event.respondWith(
    new Response(item.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': item.csp,
        'Cache-Control': 'no-store',
      },
    }),
  )
})
