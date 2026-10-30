/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach } from 'bun:test'

/**
 * Holds Bun's event loop open for the duration of every test.
 *
 * ⚠ On Windows, a lone `AbortSignal.timeout` timer is not work that keeps the
 * loop alive: measured on Bun 1.3.13, the abort fires in ~30 ms when any other
 * timer is pending and NEVER when none is. The suite is full of the shape that
 * triggers it — a fake transport returning `new Promise(() => {})` raced
 * against a deadline — so five files hung forever instead of failing:
 * `acp/serve`, `agent/run`, `provider-runtime/provider-stage`,
 * `provider-runtime/tinfoil`, `provider-runtime/usage-receipt`.
 *
 * It is not a slow test and `--timeout` does not save it. The loop stops, so
 * bun's own per-test deadline cannot fire either: the process emits no further
 * line and outlives any limit. In CI that reads as a cancelled job — which is
 * how two releases of the Windows CLI leg were lost, once at 15 minutes and
 * once at 30, each time looking like a platform that merely needed more time.
 *
 * Production is unaffected: a real `fetch` has pending I/O of its own, so the
 * deadline fires. Only a test double that pends on nothing is exposed, which
 * is why this lives in the test preload rather than in the runtime — and why
 * it belongs here rather than as a keep-alive hand-written into each fake.
 *
 * A side benefit worth keeping in mind: with the loop alive, a test that hangs
 * for any OTHER reason now trips `--timeout` and reports as a failure instead
 * of taking the whole run down in silence.
 */
let keepLoopAlive: ReturnType<typeof setInterval> | undefined

beforeEach(() => {
  keepLoopAlive = setInterval(() => {}, 20)
})

afterEach(() => {
  clearInterval(keepLoopAlive)
  keepLoopAlive = undefined
})
