/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import { CANVAS_BRIDGE_METHODS } from './canvas-bridge-protocol'
import {
  buildJsonRpcError,
  buildJsonRpcResult,
  buildToolInputNotification,
  buildToolResultNotification,
  parseCanvasBridgeMessage,
  stampCanvasNonce,
} from './canvas-bridge-host'

describe('parseCanvasBridgeMessage', () => {
  const win = {} as Window
  const nonce = 'nonce-1'
  const request = { artifactNonce: 'nonce-1', jsonrpc: '2.0' as const, id: 1, method: 'tools/call' }

  it('returns the message when source and nonce match and it is JSON-RPC', () => {
    expect(parseCanvasBridgeMessage({ source: win, data: request } as MessageEvent, win, nonce)).toEqual(request)
  })

  it('returns null on source mismatch (spoofing guard)', () => {
    expect(parseCanvasBridgeMessage({ source: {} as Window, data: request } as MessageEvent, win, nonce)).toBeNull()
  })

  it('returns null on nonce mismatch', () => {
    const other = { ...request, artifactNonce: 'other' }
    expect(parseCanvasBridgeMessage({ source: win, data: other } as MessageEvent, win, nonce)).toBeNull()
  })

  it('returns null for a legacy harness message (not JSON-RPC)', () => {
    const legacy = { artifactNonce: 'nonce-1', type: 'artifact-ready' }
    expect(parseCanvasBridgeMessage({ source: win, data: legacy } as MessageEvent, win, nonce)).toBeNull()
  })

  it('returns null when data is missing', () => {
    expect(parseCanvasBridgeMessage({ source: win, data: undefined } as MessageEvent, win, nonce)).toBeNull()
  })
})

describe('stampCanvasNonce', () => {
  const nonce = 'nonce-1'

  it('stamps artifactNonce onto an object message', () => {
    const result = buildJsonRpcResult(1, { ok: true })
    expect(stampCanvasNonce(result, nonce)).toEqual({ ...result, artifactNonce: nonce })
  })

  it('makes a host response satisfy the in-iframe listener nonce gate', () => {
    // The in-iframe bridge listener (canvas-bridge-script.ts) drops any message
    // whose `data.artifactNonce !== NONCE`. Regression for the handshake-hang
    // bug: a JSON-RPC RESPONSE (id+result, no `method`) carries no nonce of its
    // own, so `post` must stamp it — otherwise `initialize()` never resolves.
    const stamped = stampCanvasNonce(buildJsonRpcResult(1, { ok: true }), nonce) as { artifactNonce?: string }
    expect(stamped.artifactNonce).toBe(nonce)
  })

  it('leaves an unstamped response failing that gate (proves the stamp is required)', () => {
    const unstamped = buildJsonRpcResult(1, { ok: true }) as { artifactNonce?: string }
    expect(unstamped.artifactNonce).toBeUndefined()
  })

  it('passes non-object payloads through untouched', () => {
    expect(stampCanvasNonce('ping', nonce)).toBe('ping')
    expect(stampCanvasNonce(null, nonce)).toBeNull()
  })
})

describe('buildJsonRpcResult', () => {
  it('builds a success response with the given id and result', () => {
    expect(buildJsonRpcResult(7, { ok: true })).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: true } })
  })

  it('accepts a string id', () => {
    expect(buildJsonRpcResult('req-1', null)).toEqual({ jsonrpc: '2.0', id: 'req-1', result: null })
  })
})

describe('buildJsonRpcError', () => {
  it('builds an error response with the given id, code, and message', () => {
    expect(buildJsonRpcError(7, -32000, 'boom')).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32000, message: 'boom' },
    })
  })
})

describe('buildToolResultNotification', () => {
  it('builds a ui/notifications/tool-result notification carrying content and structuredContent', () => {
    expect(buildToolResultNotification({ content: 'hi', structuredContent: { a: 1 } })).toEqual({
      jsonrpc: '2.0',
      method: CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_RESULT,
      params: { content: 'hi', structuredContent: { a: 1 } },
    })
  })
})

describe('buildToolInputNotification', () => {
  it('builds a ui/notifications/tool-input notification carrying arguments', () => {
    expect(buildToolInputNotification({ arguments: { x: 1 } })).toEqual({
      jsonrpc: '2.0',
      method: CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_INPUT,
      params: { arguments: { x: 1 } },
    })
  })
})
