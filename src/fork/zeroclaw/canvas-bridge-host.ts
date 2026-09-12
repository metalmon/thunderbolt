/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { CANVAS_BRIDGE_METHODS, isJsonRpcMessage } from './canvas-bridge-protocol'
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
  if (event.source !== contentWindow) {
    return null
  }
  const data = event.data as { artifactNonce?: string } | undefined
  if (!data || data.artifactNonce !== nonce) {
    return null
  }
  return isJsonRpcMessage(data) ? data : null
}

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
  method: CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_RESULT,
  params,
})

/**
 * Build a `ui/notifications/tool-input` notification, sent to the iframe app
 * with the arguments a tool call is about to run with. A pure builder — it
 * returns the message object rather than posting it.
 */
export const buildToolInputNotification = (params: { arguments?: unknown }): JsonRpcNotification => ({
  jsonrpc: '2.0',
  method: CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_INPUT,
  params,
})
