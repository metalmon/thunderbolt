/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { describe, expect, it } from 'bun:test'
import { CANVAS_BRIDGE_METHODS } from './canvas-bridge-protocol'
import { buildCanvasBridgeScript } from './canvas-bridge-script'

describe('canvas-bridge-script', () => {
  it('embeds the nonce via JSON.stringify(nonce), mirroring the harness idiom', () => {
    const nonce = 'render-nonce-abc'
    const script = buildCanvasBridgeScript(nonce)
    expect(script).toContain(`var NONCE = ${JSON.stringify(nonce)};`)
  })

  it('emits the exact SEP-1865 wire method-name literals', () => {
    const script = buildCanvasBridgeScript('n1')
    expect(script).toContain(CANVAS_BRIDGE_METHODS.UI_INITIALIZE)
    expect(script).toContain(CANVAS_BRIDGE_METHODS.TOOLS_CALL)
    expect(script).toContain(CANVAS_BRIDGE_METHODS.UI_PROMPT)
    expect(script).toContain(CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_INITIALIZED)
    expect(script).toContain(CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_INPUT)
    expect(script).toContain(CANVAS_BRIDGE_METHODS.UI_NOTIFICATIONS_TOOL_RESULT)
  })

  it('installs window.mcpApp and posts via parent.postMessage', () => {
    const script = buildCanvasBridgeScript('n1')
    expect(script).toContain('window.mcpApp')
    expect(script).toContain('parent.postMessage')
  })

  it('is wrapped in a <script> tag, mirroring harnessScript', () => {
    const script = buildCanvasBridgeScript('n1')
    expect(script.startsWith('<script>')).toBe(true)
    expect(script.trim().endsWith('</script>')).toBe(true)
  })

  it('never contains an http/https substring (offline invariant)', () => {
    const script = buildCanvasBridgeScript('n1')
    expect(script).not.toContain('http')
    expect(script).not.toContain('https')
  })

  it('nonce-gates incoming messages before routing them', () => {
    const script = buildCanvasBridgeScript('n1')
    expect(script).toContain('artifactNonce')
    expect(script).toContain('NONCE')
  })

  it('produces different strings for different nonces', () => {
    const a = buildCanvasBridgeScript('nonce-a')
    const b = buildCanvasBridgeScript('nonce-b')
    expect(a).not.toBe(b)
  })

  it('sendPrompt sends ui/prompt id-less via notify(), not request() (spec §3b: fire-and-forget, no reply)', () => {
    const script = buildCanvasBridgeScript('n1')
    const match = script.match(/sendPrompt:\s*function\s*\([^)]*\)\s*\{([^}]*)\}/)
    expect(match).not.toBeNull()
    const body = match?.[1] ?? ''
    expect(body).toContain('notify(METHODS.UI_PROMPT')
    expect(body).not.toContain('request(')
    expect(body).not.toContain('return')
  })
})
