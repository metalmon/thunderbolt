/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ThunderboltUIMessage } from '@/types'
import { extractUiResource } from './ui-resource'

/**
 * DEV/TEST-ONLY. Opt-in ONLY — off by default in EVERY build (including dev), so a plain
 * debug build stays uncluttered. Enable with `?zcmock=1` in the URL, or run
 * `localStorage.setItem('zcmock','1'); location.reload()` in the devtools console (works in
 * both `bun run dev` and a packaged `tauri build --debug`). Gates both the inject buttons and
 * the Task 10 mock resolver. REMOVE before any real release.
 */
export const uiCanvasMockEnabled = (): boolean => {
  try {
    if (new URLSearchParams(globalThis.location?.search ?? '').get('zcmock') === '1') {
      return true
    }
    return globalThis.localStorage?.getItem('zcmock') === '1'
  } catch {
    return false
  }
}

type SetMessages = (updater: (prev: ThunderboltUIMessage[]) => ThunderboltUIMessage[]) => void

/**
 * Demo `window.mcpApp` calls (Task 10). `mcpApp` itself is installed by the host into every
 * artifact iframe (`buildCanvasBridgeScript`, injected by `src/artifacts/harness.ts` regardless
 * of this HTML's own content) — this script only exercises it, so no import/bundling is needed.
 * Kept as a plain inline `<script>`: this HTML never ships to users (dev-only mock), so it is
 * exempt from the `<Trans>` macro rule that governs real user-facing strings.
 */
const buildActionScript = (label: string, rev: number): string => `<script>
(function () {
  function log(msg) {
    var el = document.getElementById('log');
    el.textContent = (typeof msg === 'string' ? msg : JSON.stringify(msg)) + '\\n' + el.textContent;
  }
  window.mcpApp.initialize().then(function (result) {
    log('handshake ok: ' + JSON.stringify(result));
  }).catch(function (err) { log('handshake error: ' + JSON.stringify(err)); });
  document.getElementById('call-tool').addEventListener('click', function () {
    window.mcpApp.callTool('mock_tool', { rev: ${rev}, label: ${JSON.stringify(label)} })
      .then(function (result) { log('tool-only result: ' + JSON.stringify(result)); })
      .catch(function (err) { log('tool-only error: ' + JSON.stringify(err)); });
  });
  document.getElementById('call-tool-with-prompt').addEventListener('click', function () {
    window.mcpApp.callTool(
      'mock_tool',
      { rev: ${rev} },
      { prompt: 'Explain revision ${rev} of ${label}' },
    )
      .then(function (result) { log('tool+prompt result: ' + JSON.stringify(result)); })
      .catch(function (err) { log('tool+prompt error: ' + JSON.stringify(err)); });
  });
  document.getElementById('send-prompt').addEventListener('click', function () {
    window.mcpApp.sendPrompt('Tell me more about ${label}');
    log('sendPrompt fired (notification, no reply expected)');
  });
})();
</script>`

const buildHtml = (label: string, rev: number): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${label}</title>` +
  `<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;` +
  `background:var(--color-background, #0b0b0c);color:var(--color-foreground, #e5e7eb)}` +
  `h1{color:var(--color-primary, #3b82f6);margin:0 0 12px}` +
  `.bar{height:40px;background:var(--color-success, var(--color-chart-1, #22c55e));border-radius:6px;transition:width .3s}` +
  `button{margin:4px 8px 4px 0;padding:8px 12px;border-radius:6px;border:1px solid #555;` +
  `background:#1f2937;color:inherit;cursor:pointer}` +
  `#log{white-space:pre-wrap;font-family:monospace;font-size:12px;margin-top:12px;opacity:.8;max-height:160px;overflow:auto}</style>` +
  `</head><body><h1>${label}</h1><p>Revision ${rev} — self-contained offline HTML</p>` +
  `<div class="bar" style="width:${Math.min(20 * rev, 100)}%"></div>` +
  `<p><button id="call-tool">Call mock_tool (tool-only)</button>` +
  `<button id="call-tool-with-prompt">Call mock_tool + prompt (combined)</button>` +
  `<button id="send-prompt">Send prompt (no tool)</button></p>` +
  `<pre id="log"></pre>` +
  `${buildActionScript(label, rev)}</body></html>`

/** Floating dev buttons that append a synthetic `ui://` canvas tool part to the active chat. */
export const DevUiCanvasInject = ({ setMessages }: { setMessages: SetMessages }) => {
  const [rev, setRev] = useState(0)

  const emit = (uri: string, label: string) => {
    const next = rev + 1
    setRev(next)
    const content = [
      {
        type: 'content',
        content: { type: 'resource', resource: { uri, mimeType: 'text/html', text: buildHtml(label, next) } },
      },
    ]
    const uiResource = extractUiResource(content)
    if (!uiResource) {
      return
    }
    // Match what the ACP translator actually emits for an ACP tool: a TYPED
    // `tool-<name>` part (not `dynamic-tool`). `mountMessageParts` dispatches on
    // `splitPartType(type)[0]`, so only `tool-*` lands in the `case 'tool'` that
    // routes ui:// parts to the chip; `dynamic-tool` splits to `'dynamic'` and
    // renders nothing. (deliver_file rides the same typed `tool-deliver_file` path.)
    const message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: [
        {
          type: 'tool-canvas',
          toolCallId: crypto.randomUUID(),
          state: 'output-available',
          input: {},
          output: { uiResource, text: `Rendered ${label}` },
        },
      ],
    } as unknown as ThunderboltUIMessage
    setMessages((prev) => [...prev, message])
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 flex flex-col gap-2">
      <Button size="sm" variant="secondary" onClick={() => emit('ui://pnl/dashboard', 'Demo P&L Dashboard')}>
        Inject/Update dashboard (dev)
      </Button>
      <Button size="sm" variant="secondary" onClick={() => emit('ui://pnl/anomalies', 'Anomalies')}>
        Inject anomalies (dev)
      </Button>
    </div>
  )
}
