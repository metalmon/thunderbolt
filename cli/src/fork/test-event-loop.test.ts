/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { expect, test } from 'bun:test'

/**
 * Pins the preload that keeps Bun's event loop alive (`test-event-loop.ts`).
 *
 * To see it red, comment that file out of `bunfig.toml`'s `preload` and run
 * this file on Windows: the race below never settles, nothing is printed, and
 * the process outlives `--timeout` instead of failing. That is the whole point
 * — the failure mode this guards is a silent hang, not a red test, so the
 * guard has to be a test that cannot finish without the fix.
 */
test('a deadline raced against a promise that pends on nothing still fires', async () => {
  const neverSettles = new Promise<never>(() => {})
  const deadline = AbortSignal.timeout(5)
  const aborted = new Promise<string>((resolve) => {
    deadline.addEventListener('abort', () => resolve('aborted'), { once: true })
  })

  expect(await Promise.race([neverSettles, aborted])).toBe('aborted')
})
