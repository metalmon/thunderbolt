/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fork-owned (metalmon / session turn serialization). New file — do not upstream. */

/**
 * Serializes chat turns so at most one ACP prompt turn is ever in flight per
 * session. `send` is the single entry point both the composer (human,
 * `queueable: false`) and the canvas action channel (`queueable: true`) call:
 * a human send is only ever attempted while `!isBusy()` (the caller gates
 * that), so it never buffers; a canvas send buffers behind the in-flight
 * turn, up to `maxQueued`.
 *
 * `held` is the synchronous source of truth for "a turn is in flight." A
 * watchdog timer bounds how long a turn may run before it is force-aborted;
 * it never flips `held` itself — only `onTurnSettled` (driven by the chat's
 * `onFinish` choke point) does that, once the abort has actually unwound the
 * turn.
 */

/** One buffered send awaiting its turn. `stillValid` lets a stale canvas
 * click (e.g. after the app/frame that issued it unmounted) drop itself
 * instead of firing late. `onStart` (if given) runs immediately before
 * `run()`, at actual dispatch time — not at enqueue time — so a caller that
 * registers state gated by "this call is now in flight" (e.g. the canvas
 * controller's pending-call resolver map, which the F1 no-hang sweep can
 * reject on turn settle) never sees that state for a call still sitting in
 * the queue. */
export type QueuedSend = { run: () => Promise<unknown> | void; stillValid?: () => boolean; onStart?: () => void }

/** `send`'s result. `sent` is only ever present alongside `status: 'sent'` —
 *  the underlying send promise, threaded back so a caller (the composer) can
 *  recover from a rejection (busy race, pre-flight guard, or any other throw
 *  inside the now-async `start()`) instead of silently losing attachments/
 *  quotes. `'queued'` and `'rejected'` carry no promise: a queued entry's
 *  `run()` is invoked later, on drain, and its promise is discarded there
 *  (unchanged) — only an immediate send is observable by the caller. */
export type SendResult = { status: 'sent' | 'queued' | 'rejected'; sent?: Promise<unknown> }

export type SessionSendQueueDeps = {
  /** `Chat.stop()` — aborts the in-flight turn when the watchdog fires. */
  abort: () => void
  now: () => number
  /** Schedules `fn` after `ms`; returns a cancel function. Callers inject a
   *  fake in tests — this module never touches the real clock/timer. */
  setTimer: (fn: () => void, ms: number) => () => void
  watchdogMs: number
  maxQueued: number
}

export type SessionSendQueue = {
  /** True while a turn (including a scheduled retry) is in flight. Sync
   *  source of truth. */
  isBusy: () => boolean
  /** Composer/human + canvas both call this. `queueable: false` (human)
   *  never buffers — the caller only calls it while `!isBusy()`.
   *  `queueable: true` (canvas) buffers behind the in-flight turn, up to
   *  `maxQueued`. `onStart`, if given, runs immediately before `start()` —
   *  for an immediate send that's now; for a queued entry, that's at drain,
   *  never at enqueue time. */
  send: (op: {
    start: () => Promise<unknown> | void
    queueable: boolean
    stillValid?: () => boolean
    onStart?: () => void
  }) => SendResult
  /** Called by the onFinish choke point once a turn ends. `retryScheduled`
   *  keeps the turn held (a retry is about to run) and re-arms the watchdog;
   *  otherwise releases and drains one queued entry, if any. */
  onTurnSettled: (retryScheduled: boolean) => void
  /** Observe busy transitions, to mirror into a reactive store. */
  subscribe: (fn: (busy: boolean) => void) => () => void
  dispose: () => void
}

/** Creates a per-session send queue. Pure — no real timers/clock; both come
 * from `deps` so tests can drive time deterministically. */
export const createSessionSendQueue = (deps: SessionSendQueueDeps): SessionSendQueue => {
  let held = false
  const queue: QueuedSend[] = []
  const listeners = new Set<(busy: boolean) => void>()
  let cancelWatchdog: (() => void) | null = null

  const notify = (): void => {
    for (const listener of listeners) {
      listener(held)
    }
  }

  const disarmWatchdog = (): void => {
    cancelWatchdog?.()
    cancelWatchdog = null
  }

  const armWatchdog = (): void => {
    disarmWatchdog()
    cancelWatchdog = deps.setTimer(() => deps.abort(), deps.watchdogMs)
  }

  /** A turn just ended (not via a scheduled retry) while `held` is still
   *  true. Drops stale queued entries, then either hands the turn to the
   *  next valid one (held stays true) or goes idle (held -> false, notify).
   *
   *  Non-cascading by design: at most one queued entry is attempted per
   *  call. If that entry's `run()` throws, `held` resets and its OWN error
   *  is rethrown immediately — no further entries are attempted in this
   *  same call, so a second (or third...) throwing entry can never replace
   *  this one's error. Any remaining queued entries stay queued for the
   *  next settle. */
  const release = (): void => {
    disarmWatchdog()
    while (queue.length > 0 && queue[0].stillValid?.() === false) {
      queue.shift()
    }
    const next = queue.shift()
    if (!next) {
      held = false
      notify()
      return
    }
    armWatchdog()
    try {
      next.onStart?.()
      next.run()
    } catch (err) {
      disarmWatchdog()
      held = false
      notify()
      throw err
    }
  }

  return {
    isBusy: () => held,
    send: ({ start, queueable, stillValid, onStart }) => {
      if (!held) {
        held = true
        notify()
        armWatchdog()
        // `start` is async (it wraps `instance.sendMessage`), so it will
        // never throw synchronously in practice — this guard is kept anyway
        // in case a future `start` does. Its returned promise is threaded
        // back to the caller as `sent`, not awaited here: this queue only
        // cares about `onTurnSettled` (driven by the chat's own `onFinish`
        // choke point) to know when the turn ends, not about the promise's
        // resolution.
        let p: Promise<unknown> | void
        try {
          onStart?.()
          p = start()
        } catch (err) {
          release()
          throw err
        }
        return { status: 'sent', sent: p ?? undefined }
      }
      if (queueable && queue.length < deps.maxQueued) {
        queue.push({ run: start, stillValid, onStart })
        return { status: 'queued' }
      }
      return { status: 'rejected' }
    },
    onTurnSettled: (retryScheduled) => {
      // The chat instance wraps onFinish for every turn, including ones that
      // never went through send() (held === false). Those never acquired the
      // lock, so they have nothing to settle — arming the watchdog for them
      // would let an unrelated retrying turn get force-stop()-ed.
      if (!held) {
        return
      }
      if (retryScheduled) {
        armWatchdog()
        return
      }
      release()
    },
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    dispose: () => {
      disarmWatchdog()
      listeners.clear()
      queue.length = 0
    },
  }
}
