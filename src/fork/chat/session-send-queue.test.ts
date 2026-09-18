/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* src/fork/chat/session-send-queue.test.ts */
import { describe, expect, it, mock } from 'bun:test'
import { createSessionSendQueue, type SessionSendQueueDeps } from './session-send-queue'

/** Fake `setTimer`: records every scheduled call so a test can fire it
 * manually (simulating the watchdog elapsing) without a real clock. */
const makeFakeTimer = () => {
  const scheduled: { fn: () => void; ms: number; cancelled: boolean }[] = []
  const setTimer = (fn: () => void, ms: number): (() => void) => {
    const entry = { fn, ms, cancelled: false }
    scheduled.push(entry)
    return () => {
      entry.cancelled = true
    }
  }
  return { setTimer, scheduled }
}

const baseDeps = (overrides: Partial<SessionSendQueueDeps> = {}): SessionSendQueueDeps => ({
  abort: () => {},
  now: () => 0,
  setTimer: () => () => {},
  watchdogMs: 30_000,
  maxQueued: 5,
  ...overrides,
})

describe('createSessionSendQueue', () => {
  it('(a) two sends in one tick: first is sent, second (queueable) is queued', () => {
    const queue = createSessionSendQueue(baseDeps())
    const first = queue.send({ start: () => {}, queueable: false })
    const second = queue.send({ start: () => {}, queueable: true })
    expect(first).toEqual({ status: 'sent', sent: undefined })
    expect(second).toEqual({ status: 'queued' })
    expect(queue.isBusy()).toBe(true)
  })

  it('threads the underlying send promise back as `sent` for an immediate send', async () => {
    const queue = createSessionSendQueue(baseDeps())
    const sendPromise = Promise.resolve('ok')
    const result = queue.send({ start: () => sendPromise, queueable: false })
    expect(result.status).toBe('sent')
    expect(result.sent).toBe(sendPromise)
    await expect(result.sent).resolves.toBe('ok')
  })

  it('a queued send has no `sent` promise — its `run()` is only invoked on drain', () => {
    const queue = createSessionSendQueue(baseDeps())
    queue.send({ start: () => Promise.resolve(), queueable: false })
    const queuedResult = queue.send({ start: () => Promise.resolve('later'), queueable: true })
    expect(queuedResult).toEqual({ status: 'queued' })
  })

  it('a rejected send has no `sent` promise', () => {
    const queue = createSessionSendQueue(baseDeps({ maxQueued: 0 }))
    queue.send({ start: () => Promise.resolve(), queueable: false })
    const rejectedResult = queue.send({ start: () => Promise.resolve(), queueable: true })
    expect(rejectedResult).toEqual({ status: 'rejected' })
  })

  it('(b) onTurnSettled(false) drains one queued entry', () => {
    const queue = createSessionSendQueue(baseDeps())
    let queuedRan = false
    queue.send({ start: () => {}, queueable: false })
    queue.send({
      start: () => {
        queuedRan = true
      },
      queueable: true,
    })

    queue.onTurnSettled(false)

    expect(queuedRan).toBe(true)
    expect(queue.isBusy()).toBe(true) // the drained entry is now the in-flight turn
  })

  it('(c) onTurnSettled(true) keeps held and drains nothing', () => {
    const queue = createSessionSendQueue(baseDeps())
    let queuedRan = false
    queue.send({ start: () => {}, queueable: false })
    queue.send({
      start: () => {
        queuedRan = true
      },
      queueable: true,
    })

    queue.onTurnSettled(true)

    expect(queuedRan).toBe(false)
    expect(queue.isBusy()).toBe(true)
  })

  it('(d) cap overflow is rejected', () => {
    const queue = createSessionSendQueue(baseDeps({ maxQueued: 1 }))
    const first = queue.send({ start: () => {}, queueable: false })
    const second = queue.send({ start: () => {}, queueable: true })
    const third = queue.send({ start: () => {}, queueable: true })
    expect(first.status).toBe('sent')
    expect(second.status).toBe('queued')
    expect(third.status).toBe('rejected')
  })

  it('(e) an entry whose stillValid() is false is dropped, not started', () => {
    const queue = createSessionSendQueue(baseDeps())
    let staleRan = false
    let freshRan = false
    queue.send({ start: () => {}, queueable: false })
    queue.send({
      start: () => {
        staleRan = true
      },
      queueable: true,
      stillValid: () => false,
    })
    queue.send({
      start: () => {
        freshRan = true
      },
      queueable: true,
    })

    queue.onTurnSettled(false)

    expect(staleRan).toBe(false)
    expect(freshRan).toBe(true)
  })

  it('(f) watchdog firing calls abort but leaves held true until settle', () => {
    const { setTimer, scheduled } = makeFakeTimer()
    let aborted = false
    const queue = createSessionSendQueue(baseDeps({ setTimer, abort: () => (aborted = true) }))

    queue.send({ start: () => {}, queueable: false })
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].ms).toBe(30_000)

    scheduled[0].fn() // simulate the watchdog elapsing
    expect(aborted).toBe(true)
    expect(queue.isBusy()).toBe(true) // watchdog never flips held itself

    queue.onTurnSettled(false)
    expect(queue.isBusy()).toBe(false)
  })

  it('(g) start() throwing resets held instead of leaving it stuck', () => {
    const queue = createSessionSendQueue(baseDeps())
    expect(() =>
      queue.send({
        start: () => {
          throw new Error('boom')
        },
        queueable: false,
      }),
    ).toThrow('boom')
    expect(queue.isBusy()).toBe(false)
  })

  it('double-throw drain: each drained entry surfaces its own error, not the other’s', () => {
    const queue = createSessionSendQueue(baseDeps())
    const e1 = new Error('e1')
    const e2 = new Error('e2')

    queue.send({ start: () => {}, queueable: false }) // held = true
    queue.send({
      start: () => {
        throw e1
      },
      queueable: true,
    })
    queue.send({
      start: () => {
        throw e2
      },
      queueable: true,
    })

    // First settle drains only the first queued entry; its own error surfaces,
    // not e2's — and the drain does not cascade into the second entry.
    let caught: unknown
    try {
      queue.onTurnSettled(false)
    } catch (err) {
      caught = err
    }
    expect(caught).toBe(e1)
    expect(queue.isBusy()).toBe(false) // reset, not stuck held=true

    // The second queued entry is untouched, still awaiting a future turn.
    // Starting + settling a fresh turn drains it in isolation: its OWN error
    // surfaces (e2), never replaced by e1's (already resolved) error.
    queue.send({ start: () => {}, queueable: false })
    let caughtSecond: unknown
    try {
      queue.onTurnSettled(false)
    } catch (err) {
      caughtSecond = err
    }
    expect(caughtSecond).toBe(e2)
    expect(queue.isBusy()).toBe(false) // no deadlock after the second throw either
  })

  it('a non-queueable (human) send while busy is rejected, not buffered', () => {
    const queue = createSessionSendQueue(baseDeps())
    queue.send({ start: () => {}, queueable: false })
    const second = queue.send({ start: () => {}, queueable: false })
    expect(second.status).toBe('rejected')
  })

  it('subscribe observes busy transitions and unsubscribe stops notifications', () => {
    const queue = createSessionSendQueue(baseDeps())
    const seen: boolean[] = []
    const unsubscribe = queue.subscribe((busy) => seen.push(busy))

    queue.send({ start: () => {}, queueable: false })
    queue.onTurnSettled(false)
    expect(seen).toEqual([true, false])

    unsubscribe()
    queue.send({ start: () => {}, queueable: false })
    expect(seen).toEqual([true, false]) // no further notifications after unsubscribe
  })

  it('onTurnSettled is a no-op when the queue never acquired the lock (held === false)', () => {
    const { setTimer, scheduled } = makeFakeTimer()
    const abortSpy = mock(() => {})
    const queue = createSessionSendQueue(baseDeps({ setTimer, abort: abortSpy }))

    // No send() was ever issued through this queue — held is false — yet the
    // chat instance still calls onTurnSettled for every turn's onFinish.
    queue.onTurnSettled(true)

    expect(scheduled).toHaveLength(0) // watchdog was never armed for a non-held turn
    expect(abortSpy).not.toHaveBeenCalled()
    expect(queue.isBusy()).toBe(false)
  })

  it('onTurnSettled still re-arms/drains normally for a turn that did acquire the lock', () => {
    const { setTimer, scheduled } = makeFakeTimer()
    let aborted = false
    let queuedRan = false
    const queue = createSessionSendQueue(baseDeps({ setTimer, abort: () => (aborted = true) }))

    queue.send({ start: () => {}, queueable: false }) // held = true, watchdog #1 armed
    queue.send({
      start: () => {
        queuedRan = true
      },
      queueable: true,
    })

    queue.onTurnSettled(true) // retry path: stays held, re-arms (watchdog #1 cancelled, #2 armed)
    expect(scheduled[0].cancelled).toBe(true)
    expect(scheduled).toHaveLength(2)
    expect(queue.isBusy()).toBe(true)
    expect(queuedRan).toBe(false) // no drain on the retry path

    queue.onTurnSettled(false) // settle path: disarms, drains the queued entry
    expect(scheduled[1].cancelled).toBe(true)
    expect(queuedRan).toBe(true)
    expect(queue.isBusy()).toBe(true) // the drained entry is the new in-flight turn

    scheduled[2].fn() // its own watchdog still works
    expect(aborted).toBe(true)
  })

  it("a queued entry's onStart fires only when it drains, not at enqueue", () => {
    const queue = createSessionSendQueue(baseDeps())
    const order: string[] = []
    queue.send({ start: () => {}, queueable: false }) // held = true

    const queuedResult = queue.send({
      start: () => {
        order.push('run')
      },
      queueable: true,
      onStart: () => {
        order.push('onStart')
      },
    })
    expect(queuedResult).toEqual({ status: 'queued' })
    expect(order).toEqual([]) // not called yet — still just sitting in the queue

    queue.onTurnSettled(false) // drains the queued entry
    expect(order).toEqual(['onStart', 'run']) // onStart runs immediately before run(), at drain time
  })

  it('onStart fires immediately (before start()) for an immediate, non-queued send', () => {
    const queue = createSessionSendQueue(baseDeps())
    const order: string[] = []
    queue.send({
      start: () => {
        order.push('start')
      },
      queueable: false,
      onStart: () => {
        order.push('onStart')
      },
    })
    expect(order).toEqual(['onStart', 'start'])
  })

  it('dispose cancels the pending watchdog and clears the queue', () => {
    const { setTimer, scheduled } = makeFakeTimer()
    const queue = createSessionSendQueue(baseDeps({ setTimer }))
    queue.send({ start: () => {}, queueable: false })

    queue.dispose()

    expect(scheduled[0].cancelled).toBe(true)
  })

  /** A controllable promise: `resolve` is exposed so a scripted test can
   *  decide exactly when a "turn" completes, independent of the queue (which
   *  never awaits `start()`'s return value itself — it only reacts to
   *  `onTurnSettled`). */
  const createDeferred = <T,>(): { promise: Promise<T>; resolve: (value: T) => void } => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it('invariant: a scripted timeline of concurrent/queued sends, a retry, and a watchdog-abort never runs two turns concurrently, and drains queued turns in FIFO order', () => {
    const { setTimer, scheduled } = makeFakeTimer()
    const log: string[] = []
    let abortCount = 0
    const queue = createSessionSendQueue(baseDeps({ setTimer, abort: () => (abortCount += 1), maxQueued: 2 }))

    const d1 = createDeferred<string>()
    const d2 = createDeferred<string>()
    const d3 = createDeferred<string>()

    // Three sends land in the same tick: t1 (queueable: false, like the
    // composer) runs immediately; t2 and t3 (queueable: true, like canvas
    // clicks) buffer behind it, FIFO.
    const r1 = queue.send({
      start: () => {
        log.push('start:t1')
        return d1.promise
      },
      queueable: false,
    })
    const r2 = queue.send({
      start: () => {
        log.push('start:t2')
        return d2.promise
      },
      queueable: true,
    })
    const r3 = queue.send({
      start: () => {
        log.push('start:t3')
        return d3.promise
      },
      queueable: true,
    })

    expect(r1.status).toBe('sent')
    expect(r2.status).toBe('queued')
    expect(r3.status).toBe('queued')
    expect(log).toEqual(['start:t1'])
    expect(queue.isBusy()).toBe(true)
    expect(scheduled).toHaveLength(1) // t1's watchdog

    // t1 comes back empty and retries (e.g. an ACP empty-turn retry) before
    // succeeding: held stays true, nothing drains, no second start fires.
    d1.resolve('t1-empty')
    log.push('retry:t1')
    queue.onTurnSettled(true)
    expect(queue.isBusy()).toBe(true)
    expect(log).toEqual(['start:t1', 'retry:t1'])
    expect(scheduled).toHaveLength(2) // watchdog re-armed for the retry
    expect(scheduled[0].cancelled).toBe(true)

    // t1 finally succeeds: settling with retryScheduled=false releases it
    // and drains the NEXT queued entry — t2, not t3 (FIFO).
    log.push('settle:t1')
    queue.onTurnSettled(false)
    expect(log).toEqual(['start:t1', 'retry:t1', 'settle:t1', 'start:t2'])
    expect(queue.isBusy()).toBe(true)
    expect(scheduled).toHaveLength(3) // t2's own watchdog armed on drain
    expect(scheduled[1].cancelled).toBe(true)

    // t2 hangs; its watchdog elapses and force-aborts it. Firing the
    // watchdog only calls `deps.abort()` — it must NOT itself start a new
    // turn or flip `held` (that only happens via `onTurnSettled`).
    scheduled[2].fn()
    expect(abortCount).toBe(1)
    expect(log).toEqual(['start:t1', 'retry:t1', 'settle:t1', 'start:t2']) // unchanged
    expect(queue.isBusy()).toBe(true)

    // The abort unwinds t2's turn; the chat's onFinish choke point settles
    // it (the isAbort path still calls onTurnSettled(false)), releasing the
    // queue and draining t3 next.
    log.push('settle:t2')
    queue.onTurnSettled(false)
    expect(log).toEqual(['start:t1', 'retry:t1', 'settle:t1', 'start:t2', 'settle:t2', 'start:t3'])
    expect(queue.isBusy()).toBe(true)
    expect(scheduled).toHaveLength(4) // t3's own watchdog armed on drain

    // t3 succeeds; the queue goes idle.
    log.push('settle:t3')
    queue.onTurnSettled(false)
    expect(queue.isBusy()).toBe(false)

    const finalLog = ['start:t1', 'retry:t1', 'settle:t1', 'start:t2', 'settle:t2', 'start:t3', 'settle:t3']
    // Non-vacuous: assert the exact ordered log, not just counts.
    expect(log).toEqual(finalLog)

    // Invariant (a): never two turns "in flight" at once. A turn is in
    // flight from its `start:` entry until the next `settle:` entry that
    // releases it; a `retry:` entry keeps the SAME turn in flight (it is
    // not a second start) and must reference the currently in-flight turn.
    let inFlight: string | null = null
    for (const entry of log) {
      const [event, label] = entry.split(':')
      if (event === 'start') {
        expect(inFlight).toBeNull() // no second start while one is in flight
        inFlight = label
      } else if (event === 'retry') {
        expect(inFlight).toBe(label)
      } else if (event === 'settle') {
        expect(inFlight).toBe(label)
        inFlight = null
      }
    }
    expect(inFlight).toBeNull() // nothing left in flight at the end

    // Invariant (b): FIFO — queued turns start in enqueue order (t1, t2, t3).
    const startOrder = log.filter((entry) => entry.startsWith('start:')).map((entry) => entry.split(':')[1])
    expect(startOrder).toEqual(['t1', 't2', 't3'])
  })
})
