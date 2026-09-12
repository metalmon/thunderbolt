/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

import { isToolOrDynamicToolUIPart, type ToolUIPart } from 'ai'
import type { ThunderboltUIMessage } from '@/types'
import { parseCanvasToolCallId } from './canvas-call-id'

/**
 * A canvas-proxied `tools/call` awaiting resolution. `callId` is the composed
 * wire id (`composeCanvasCallId(nonce, appCallId)`); `jsonRpcId` is the Wire A
 * request id the eventual JSON-RPC response must carry.
 */
export type PendingCall = { callId: string; nonce: string; jsonRpcId: string | number }

/** One `pending` entry resolved by an observed tool part. */
export type ResolvedPending = { pending: PendingCall; output: unknown; failed: boolean }

/**
 * Fixed-window rate limiter keyed by nonce (one window per live canvas
 * frame): each nonce gets up to `limit` calls in a `windowMs`-long window,
 * and the window resets (rather than sliding) the first time it's checked
 * after expiring. Takes `now` as a parameter instead of reading `Date.now()`
 * internally so callers can drive it deterministically in tests.
 *
 * @param limit - max calls allowed per window
 * @param windowMs - window length in milliseconds
 */
export const createNonceRateLimiter = (
  limit: number,
  windowMs: number,
): { allow: (nonce: string, now: number) => boolean } => {
  const windows = new Map<string, { windowStart: number; count: number }>()
  return {
    allow: (nonce, now) => {
      const bucket = windows.get(nonce)
      if (!bucket || now - bucket.windowStart >= windowMs) {
        windows.set(nonce, { windowStart: now, count: 1 })
        return true
      }
      if (bucket.count >= limit) {
        return false
      }
      bucket.count += 1
      return true
    },
  }
}

/** The composed callId's opaque app-id suffix, or null if it isn't `<nonce>:<appId>`. */
const appCallIdOf = (call: PendingCall): string | null => {
  const prefix = `${call.nonce}:`
  return call.callId.startsWith(prefix) ? call.callId.slice(prefix.length) : null
}

/**
 * For each `pending` call, scan `messages` for a tool part whose
 * `parseCanvasToolCallId(part.toolCallId)` matches its `(nonce, appCallId)`
 * pair AND whose state is `output-available` or `output-error`. A part
 * parsing to a DIFFERENT nonce (stale/cross-frame — e.g. after a reload)
 * never matches even if its app-id suffix happens to collide. Reuses the
 * tool-part iteration idiom from `computeLatestByUri` (`./canvas-registry`):
 * later parts win when more than one message could match the same pending.
 *
 * @param messages - the chat transcript to scan
 * @param pending - the canvas tool calls currently awaiting resolution
 * @returns one entry per pending call that has a matching completed tool part
 */
export const findResolvedPending = (messages: ThunderboltUIMessage[], pending: PendingCall[]): ResolvedPending[] => {
  const results: ResolvedPending[] = []
  for (const call of pending) {
    const appCallId = appCallIdOf(call)
    if (appCallId === null) {
      continue
    }
    let matched: ResolvedPending | null = null
    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolOrDynamicToolUIPart(part)) {
          continue
        }
        const parsed = parseCanvasToolCallId((part as ToolUIPart).toolCallId)
        if (!parsed || parsed.nonce !== call.nonce || parsed.appCallId !== appCallId) {
          continue
        }
        const state = (part as ToolUIPart).state
        if (state === 'output-available') {
          matched = { pending: call, output: (part as ToolUIPart).output, failed: false }
        } else if (state === 'output-error') {
          matched = { pending: call, output: (part as ToolUIPart).errorText, failed: true }
        }
      }
    }
    if (matched) {
      results.push(matched)
    }
  }
  return results
}
