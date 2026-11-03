/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt live-test). See ./FORK.md — do not upstream. */

import { canvasBridgeMethods, isJsonRpcMessage } from './canvas-bridge-protocol'
import { traceCanvas } from './canvas-trace'
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from './canvas-bridge-protocol'

/**
 * Validate and decode a `postMessage` sent by the in-iframe canvas bridge
 * script (`canvas-bridge-script.ts`) to the host: it must originate from that
 * iframe's own window and carry the matching per-render nonce, and its
 * payload must be a Wire A JSON-RPC request or notification. Returns the
 * typed message, or `null` to ignore. Mirrors `parseHarnessMessage`'s gating
 * (`src/artifacts/harness.ts`) exactly, so the two channels that share one
 * iframe can't drift on source/nonce validation.
 */
export const parseCanvasBridgeMessage = (
  event: MessageEvent,
  contentWindow: Window | null,
  nonce: string,
): JsonRpcRequest | JsonRpcNotification | null => {
  const data = event.data as { artifactNonce?: string; method?: unknown } | undefined
  // Only bridge traffic is traced. The harness shares this channel and stamps the same
  // nonce for its own `artifact-*` messages (height, selection, context), so tracing
  // every rejection buried the one line that matters under its chatter.
  const isBridgeShaped = typeof data?.method === 'string'

  if (event.source !== contentWindow) {
    // The one rejection that used to leave no trace at all, which is why a handshake
    // could vanish with the log showing nothing but harness noise. A method-bearing
    // message from another window is worth a line precisely because it means the page
    // IS talking and we are listening to the wrong frame.
    if (isBridgeShaped) {
      traceCanvas(`inbound dropped: wrong source window (method=${String(data?.method)})`)
    }
    return null
  }
  if (!data) {
    traceCanvas('inbound dropped: empty payload')
    return null
  }
  if (data.artifactNonce !== nonce) {
    if (isBridgeShaped) {
      traceCanvas(
        `inbound dropped: nonce mismatch (method=${String(data.method)}, got=${String(data.artifactNonce ?? '—')}, want=${nonce})`,
      )
    }
    return null
  }
  if (!isJsonRpcMessage(data)) {
    if (isBridgeShaped) {
      traceCanvas(`inbound dropped: not a JSON-RPC message (method=${String(data.method)})`)
    }
    return null
  }
  return data
}

/**
 * Stamp the frame's per-render nonce onto a host→iframe message so the
 * in-iframe bridge listener accepts it. The exact inverse of
 * {@link parseCanvasBridgeMessage}'s inbound gate: the script drops any
 * message whose `artifactNonce` doesn't match (`canvas-bridge-script.ts`),
 * so every response and notification the host posts back must carry it —
 * mirroring how the script stamps its own outbound messages. Non-object
 * payloads pass through untouched (the builders always return objects, but
 * `post` accepts `unknown`). A pure function; the frame's `post` sends the
 * result.
 */
export const stampCanvasNonce = (message: unknown, nonce: string): unknown =>
  message && typeof message === 'object' ? { ...(message as Record<string, unknown>), artifactNonce: nonce } : message

/**
 * Build a successful JSON-RPC response to a `tools/call` (or other)
 * request. A pure builder — it returns the message object rather than
 * posting it; the frame's own `post` function sends it.
 */
export const buildJsonRpcResult = (id: string | number, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

/**
 * Build a JSON-RPC error response for a failed request. A pure builder — it
 * returns the message object rather than posting it.
 */
export const buildJsonRpcError = (id: string | number, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

/**
 * Build a `ui/notifications/tool-result` notification, sent to the iframe
 * app after a `tools/call` it triggered completes. A pure builder — it
 * returns the message object rather than posting it.
 */
export const buildToolResultNotification = (params: {
  content?: unknown
  structuredContent?: unknown
}): JsonRpcNotification => ({
  jsonrpc: '2.0',
  method: canvasBridgeMethods.UI_NOTIFICATIONS_TOOL_RESULT,
  params,
})

/**
 * Build a `ui/notifications/tool-input` notification, sent to the iframe app
 * with the arguments a tool call is about to run with. A pure builder — it
 * returns the message object rather than posting it.
 */
export const buildToolInputNotification = (params: { arguments?: unknown }): JsonRpcNotification => ({
  jsonrpc: '2.0',
  method: canvasBridgeMethods.UI_NOTIFICATIONS_TOOL_INPUT,
  params,
})
