/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/**
 * Named Wire A JSON-RPC error codes/messages used by the Canvas Action
 * Channel controller (`./canvas-action-channel`). Centralizing them here
 * removes the previous duplication (the read-only error was inlined
 * verbatim at two call sites) and gives {@link classifyCanvasRequest} a
 * single source of truth to return from. Codes are preserved verbatim from
 * the prior inline literals — this is a pure rename, not a protocol change.
 * Messages are protocol-facing (sent to the `ui://` iframe app), so they
 * stay in English and are not run through i18n.
 */
export const CANVAS_JSONRPC_ERRORS = {
  /** A tool call the app proxied through us failed, or its owning frame is gone (F1 no-hang / F7 reload). */
  TOOL_FAILED: { code: -32000, message: 'tool failed' },
  /** No `ui://` canvas is currently open in the side panel. */
  NO_CANVAS: { code: -32001, message: 'no active canvas' },
  /** The open canvas was emitted by an agent that is no longer selected (agent-switch read-only snapshot). */
  READ_ONLY: { code: -32003, message: 'canvas is a read-only snapshot (agent changed)' },
  /** The per-nonce `tools/call` rate limit (`./canvas-pending`'s `createNonceRateLimiter`) rejected this call. */
  RATE_LIMITED: { code: -32005, message: 'rate limited' },
  /** A `tools/call` request is missing its required `name` param. */
  INVALID_PARAMS: { code: -32602, message: 'invalid params: name is required' },
  /** A chat turn is already in flight on this session: accepting another canvas action now would
   *  start a re-entrant `makeRequest` on the one active `Chat`, clobbering its single in-flight
   *  response slot (crash). The app should retry once the current turn settles. */
  BUSY: { code: -32002, message: 'host busy: a turn is already in progress' },
} as const

/** The outcome of {@link classifyCanvasRequest}: either proceed, or reject with a named error. */
export type CanvasRequestDecision = { kind: 'proceed' } | { kind: 'reject'; error: { code: number; message: string } }

/**
 * Pure gate-ordering decision for a canvas-proxied request (`tools/call`, or
 * `ui/prompt` when its own guards apply — see the controller for how each
 * caller maps its own checks onto these booleans). Checked in priority
 * order so a request rejected by an earlier gate never reaches a later one:
 *
 * 1. no active canvas (`NO_CANVAS`)
 * 2. read-only snapshot, agent switched (`READ_ONLY`)
 * 3. rate limit exhausted (`RATE_LIMITED`)
 * 4. missing tool name, `tools/call` only (`INVALID_PARAMS`)
 * 5. otherwise proceed
 *
 * `rateAllowed` reflects a limiter call that has a side effect (it consumes
 * a token) — callers MUST NOT call the limiter until after they've confirmed
 * `hasCanvas` and `!isReadOnly` themselves, so a request that this function
 * would reject on an earlier gate never consumes rate-limit budget. This
 * function itself is pure; it only decides, never calls the limiter.
 */
export const classifyCanvasRequest = (input: {
  hasCanvas: boolean
  isReadOnly: boolean
  rateAllowed: boolean
  /** For `tools/call` param validation; pass `true` for callers with no tool-name param (e.g. `ui/prompt`). */
  hasToolName: boolean
}): CanvasRequestDecision => {
  if (!input.hasCanvas) {
    return { kind: 'reject', error: CANVAS_JSONRPC_ERRORS.NO_CANVAS }
  }
  if (input.isReadOnly) {
    return { kind: 'reject', error: CANVAS_JSONRPC_ERRORS.READ_ONLY }
  }
  if (!input.rateAllowed) {
    return { kind: 'reject', error: CANVAS_JSONRPC_ERRORS.RATE_LIMITED }
  }
  if (!input.hasToolName) {
    return { kind: 'reject', error: CANVAS_JSONRPC_ERRORS.INVALID_PARAMS }
  }
  return { kind: 'proceed' }
}
