/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { type Clock, install } from '@sinonjs/fake-timers'
import { jest as bunJest } from 'bun:test'

/**
 * The clock for the currently-executing test. @testing-library's `waitFor`
 * polls via `jest.advanceTimersByTime`, resolving `jest` from `bun:test` — NOT
 * the `globalThis.jest` object rebound in installFakeTimers below. When an
 * unawaited render leaves a `waitFor` poll pending across the afterEach timer
 * teardown, that poll ticks once the clock is gone; unguarded, bun's native
 * `advanceTimersByTime` throws "Fake timers are not active", poisoning every
 * later test in the randomized run. Routing bun's jest timer methods through
 * this guarded indirection makes a straddling poll a harmless no-op instead.
 */
let activeClock: Clock | null = null

const guardedTick = (fn: (clock: Clock) => void) => () => {
  if (activeClock) fn(activeClock)
}

bunJest.advanceTimersByTime = ((ms: number) => activeClock?.tick(ms)) as typeof bunJest.advanceTimersByTime
bunJest.runAllTimers = guardedTick((clock) => clock.runAll()) as typeof bunJest.runAllTimers
bunJest.runOnlyPendingTimers = guardedTick((clock) => clock.runToLast()) as typeof bunJest.runOnlyPendingTimers
bunJest.clearAllTimers = guardedTick((clock) => clock.reset()) as typeof bunJest.clearAllTimers

/**
 * Creates and installs fake timers for testing.
 * Returns a clock object that can be used to control time.
 *
 * Also sets up Jest-compatible API for @testing-library/react compatibility.
 *
 * @example
 * const clock = installFakeTimers()
 * // ... test code ...
 * await clock.tickAsync(1000) // advance time by 1 second
 * clock.uninstall()
 */
export const installFakeTimers = (config?: { now?: number; shouldAdvanceTime?: boolean }): Clock => {
  const clock = install({
    now: config?.now ?? Date.now(),
    shouldAdvanceTime: config?.shouldAdvanceTime ?? false,
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  })

  activeClock = clock
  const originalUninstall = clock.uninstall.bind(clock)
  clock.uninstall = () => {
    if (activeClock === clock) activeClock = null
    originalUninstall()
  }

  // Update Jest-compatible API implementations
  // CRITICAL: We must UPDATE the existing jest object, not replace it
  // because @testing-library/react may have already captured a reference
  // @ts-ignore
  const jestGlobal = globalThis.jest || global.jest

  if (jestGlobal) {
    jestGlobal.advanceTimersByTime = (ms: number) => clock.tick(ms)
    jestGlobal.runAllTimers = () => clock.runAll()
    jestGlobal.runOnlyPendingTimers = () => clock.runToLast()
    jestGlobal.clearAllTimers = () => clock.reset()
    jestGlobal.getTimerCount = () => clock.countTimers()
  } else {
    // Fallback: create new object if it doesn't exist
    const jestImpl = {
      advanceTimersByTime: (ms: number) => clock.tick(ms),
      runAllTimers: () => clock.runAll(),
      runOnlyPendingTimers: () => clock.runToLast(),
      clearAllTimers: () => clock.reset(),
      getTimerCount: () => clock.countTimers(),
    }
    // @ts-ignore
    globalThis.jest = jestImpl
    // @ts-ignore
    global.jest = jestImpl
  }

  return clock
}
