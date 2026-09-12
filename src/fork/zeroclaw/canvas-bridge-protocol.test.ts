/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import { CANVAS_BRIDGE_METHODS, isJsonRpcMessage } from './canvas-bridge-protocol'

describe('canvas-bridge-protocol', () => {
  describe('isJsonRpcMessage', () => {
    it('accepts a well-formed JSON-RPC request', () => {
      expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'tools/call', id: 1 })).toBe(true)
    })

    it('accepts a well-formed JSON-RPC notification (no id)', () => {
      expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })).toBe(true)
    })

    it('rejects a legacy artifact-ready message', () => {
      expect(isJsonRpcMessage({ artifactNonce: 'n1', type: 'artifact-ready' })).toBe(false)
    })

    it('rejects a non-object', () => {
      expect(isJsonRpcMessage('not an object')).toBe(false)
      expect(isJsonRpcMessage(null)).toBe(false)
      expect(isJsonRpcMessage(undefined)).toBe(false)
      expect(isJsonRpcMessage(42)).toBe(false)
    })

    it('rejects an object missing jsonrpc version', () => {
      expect(isJsonRpcMessage({ method: 'tools/call' })).toBe(false)
    })

    it('rejects an object with a non-string method', () => {
      expect(isJsonRpcMessage({ jsonrpc: '2.0', method: 42 })).toBe(false)
    })
  })

  describe('CANVAS_BRIDGE_METHODS', () => {
    it('exposes the exact SEP-1865 wire method-name strings', () => {
      expect(CANVAS_BRIDGE_METHODS.UI_INITIALIZE).toBe('ui/initialize')
      expect(CANVAS_BRIDGE_METHODS.TOOLS_CALL).toBe('tools/call')
      expect(CANVAS_BRIDGE_METHODS.UI_PROMPT).toBe('ui/prompt')
      expect(CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_INITIALIZED).toBe('ui/notifications/initialized')
      expect(CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_INPUT).toBe('ui/notifications/tool-input')
      expect(CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_RESULT).toBe('ui/notifications/tool-result')
    })
  })
})
