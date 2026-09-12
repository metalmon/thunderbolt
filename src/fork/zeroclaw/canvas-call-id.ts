/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / ZeroClaw live-test). See ./FORK.md — do not upstream. */

/** ZeroClaw derives the ACP `toolCallId` of a canvas-origin tool call as `canvas:<callId>`. */
export const CANVAS_TOOLCALL_PREFIX = 'canvas:'

/**
 * Wire `callId` for a canvas-proxied tool call: `<artifactNonce>:<appCallId>`.
 * Volt composes it at the seam where it attaches `_meta` — it already holds the
 * render's nonce; the app chooses only the (opaque) suffix. See spec §3.
 */
export const composeCanvasCallId = (artifactNonce: string, appCallId: string): string => `${artifactNonce}:${appCallId}`

/**
 * Recover `(nonce, appCallId)` from a `canvas:<nonce>:<appId>` ACP `toolCallId`.
 * PARSED POSITIONALLY, never a naive `split(':')`: the app-id suffix is untrusted
 * and may itself contain `:` (or the literal `canvas:`). The nonce is the fixed
 * segment right after the `canvas:` prefix; the ENTIRE remainder is the opaque
 * app-id — so a colon-stuffed suffix cannot shift or forge the nonce (spec §3).
 * Returns null for any non-canvas or malformed id.
 */
export const parseCanvasToolCallId = (toolCallId: string): { nonce: string; appCallId: string } | null => {
  if (!toolCallId.startsWith(CANVAS_TOOLCALL_PREFIX)) {
    return null
  }
  const rest = toolCallId.slice(CANVAS_TOOLCALL_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep <= 0 || sep === rest.length - 1) {
    return null
  }
  return { nonce: rest.slice(0, sep), appCallId: rest.slice(sep + 1) }
}
