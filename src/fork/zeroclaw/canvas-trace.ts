/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / Volt). See ./FORK.md — do not upstream. */

/**
 * A capped trace of the canvas bridge, written to the boot log.
 *
 * Why this exists: every way the Wire A path can fail is silent by construction. The
 * inbound parse drops a message on three separate conditions and returns `null` for all
 * of them; the controller used to drop requests with no session; a pending `tools/call`
 * that never resolves simply never answers. The app's promise then stays pending, the
 * panel shows its chrome and nothing else, and no console is reachable in a release
 * build. That shape has now cost two field rounds.
 *
 * So the bridge says where a message died, in the one place a customer can already be
 * asked for — `<app data>/boot.log` (see `@/fork/boot-log/boot-log`).
 *
 * Capped per launch rather than throttled: a page that retries in a loop must not push
 * the boot sequence out of a file people read from the top, and the first few messages
 * are the ones that matter — a handshake that fails fails immediately.
 */
import { forkBootLog } from '@/fork/boot-log/boot-log'

/** Lines per launch. Enough for a handshake plus the first calls, short enough to read. */
const traceCap = 40

let written = 0

/**
 * Record one canvas-bridge event. Does nothing once the per-launch cap is reached, and
 * never throws — this is a diagnostic, and a diagnostic that can break the path it
 * watches is worse than none.
 */
export const traceCanvas = (line: string): void => {
  if (written >= traceCap) {
    return
  }
  written += 1
  forkBootLog(written === traceCap ? `canvas: ${line} (trace cap reached)` : `canvas: ${line}`)
}

/** Test seam: the cap is module state, so a suite that asserts it must be able to clear it. */
export const resetCanvasTraceForTest = (): void => {
  written = 0
}
