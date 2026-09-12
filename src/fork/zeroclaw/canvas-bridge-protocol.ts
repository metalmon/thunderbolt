/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * "Wire A" — the iframe↔host JSON-RPC protocol used by the Canvas Action
 * Channel (MCP Apps SEP-1865). These are the exact wire method-name strings;
 * downstream code and the in-iframe bridge script depend on the literal
 * values, not just the constant identifiers, so never rename the strings.
 */
export const CANVAS_BRIDGE_METHODS = {
  UI_INITIALIZE: 'ui/initialize',
  TOOLS_CALL: 'tools/call',
  UI_PROMPT: 'ui/prompt',
  UI_NOTIFICATIONS_INITIALIZED: 'ui/notifications/initialized',
  UI_NOTIFICATIONS_TOOL_INPUT: 'ui/notifications/tool-input',
  UI_NOTIFICATIONS_TOOL_RESULT: 'ui/notifications/tool-result',
} as const

/** A JSON-RPC 2.0 request: expects a response correlated by `id`. */
export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

/** A JSON-RPC 2.0 notification: no `id`, no response expected. */
export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

/** A JSON-RPC 2.0 response to a previously-sent {@link JsonRpcRequest}. */
export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/**
 * Params for a `tools/call` request. `prompt` is the combined-mode extra
 * field (spec §3c): the app supplies both a tool invocation and a natural-
 * language prompt to run alongside it.
 */
export type ToolsCallParams = {
  name: string
  arguments?: Record<string, unknown>
  prompt?: string
}

/** Params for a `ui/prompt` notification: the app asks the host to run a prompt. */
export type UiPromptParams = {
  prompt: string
}

/** Host-provided context handed to the iframe app at `ui/initialize`. */
export type HostContext = {
  theme: 'light' | 'dark' | 'paper'
  readOnly?: boolean
}

/**
 * Narrows an arbitrary `postMessage` payload to a Wire A JSON-RPC message
 * (request or notification). Rejects the legacy `{artifactNonce, type}`
 * shape and any non-object payload.
 */
export const isJsonRpcMessage = (data: unknown): data is JsonRpcRequest | JsonRpcNotification =>
  typeof data === 'object' &&
  data !== null &&
  (data as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
  typeof (data as { method?: unknown }).method === 'string'
