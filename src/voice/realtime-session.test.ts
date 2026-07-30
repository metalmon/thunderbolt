/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { MicCapture } from '@/voice/audio/mic-capture'
import type { PlaybackQueue } from '@/voice/audio/playback'
import type { VadGate, VadHandlers } from '@/voice/audio/vad'
import type { AudioChunk } from '@/voice/engine/types'
import type { RealtimeEngine, RealtimeEvent } from '@/voice/engine/realtime-types'
import { getClock } from '@/testing-library'
import type { SessionState } from '@/voice/session'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

// The session must capture the mic *continuously* (no VAD gate) — mock the mic
// module so the test can push synthetic frames through the exact same seam the
// real AudioWorklet uses, and mock the VAD module with a spy so we can assert
// the realtime session never touches it (the hard invariant this task fixes).
let capturedOnFrame: ((frame: Float32Array) => void) | null = null
let micStartCalls = 0
let micDestroyCalls = 0

const resetMic = () => {
  capturedOnFrame = null
  micStartCalls = 0
  micDestroyCalls = 0
}

mock.module('@/voice/audio/mic-capture', () => ({
  createMicCapture: (onFrame: (frame: Float32Array) => void): MicCapture => {
    capturedOnFrame = onFrame
    return {
      start: async () => {
        micStartCalls++
      },
      destroy: async () => {
        micDestroyCalls++
      },
    }
  },
}))

const createVadGateSpy = mock((_handlers: VadHandlers): VadGate => ({
  start: async () => {},
  pause: async () => {},
  destroy: async () => {},
  setListening: () => {},
}))

mock.module('@/voice/audio/vad', () => ({
  createVadGate: createVadGateSpy,
}))

let enqueued: AudioChunk[] = []
let flushCalls = 0
let playing = false

const resetPlayback = () => {
  enqueued = []
  flushCalls = 0
  playing = false
}

mock.module('@/voice/audio/playback', () => ({
  createPlaybackQueue: (): PlaybackQueue =>
    ({
      // Mirror the real queue: enqueuing starts playback; flush stops it.
      enqueue: (chunk: AudioChunk) => {
        enqueued.push(chunk)
        playing = true
      },
      flush: () => {
        flushCalls++
        playing = false
      },
      close: () => {},
      getLevel: () => 0,
      get isPlaying() {
        return playing
      },
    }) as unknown as PlaybackQueue,
}))

const { createRealtimeSession } = await import('@/voice/realtime-session')

/** A spy `RealtimeEngine` — records every `sendAudio` call in order and lets
 *  the test control when `events()` resolves. */
const makeEngine = (
  overrides: Partial<RealtimeEngine> = {},
): { engine: RealtimeEngine; sendAudioCalls: Int16Array[]; sendTextCalls: string[] } => {
  const sendAudioCalls: Int16Array[] = []
  const sendTextCalls: string[] = []
  const engine: RealtimeEngine = {
    id: 'test-engine',
    connect: async () => {},
    sendAudio: (frame) => {
      sendAudioCalls.push(frame)
    },
    sendText: (text) => {
      sendTextCalls.push(text)
    },
    sendToolResponse: () => {},
    events: () =>
      (async function* () {
        // No events — this test only exercises the mic → sendAudio path.
      })(),
    close: () => {},
    ...overrides,
  }
  return { engine, sendAudioCalls, sendTextCalls }
}

/** Build a distinctive Float32 frame so converted Int16 values are order-verifiable. */
const makeFrame = (value: number): Float32Array => new Float32Array([value, value, value, value])

/** Drain the promise microtask queue so the session's background `processEvents`
 *  loop consumes already-yielded events. The global test preload installs sinon
 *  fake timers (see `src/testing-library.ts`), so a real `setTimeout` never fires
 *  — and the realtime audio path schedules no timers anyway, only microtasks. */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}

/** Mirrors the implementation's truncating (not rounding) quantization — the
 *  same convention `audio-engine.ts`'s `encodeWav` and `DataView.setInt16` use. */
const float32ToInt16Sample = (s: number): number => {
  const clamped = Math.max(-1, Math.min(1, s))
  return Math.trunc(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

describe('createRealtimeSession — continuous mic capture', () => {
  beforeEach(() => {
    resetMic()
    createVadGateSpy.mockClear()
    resetPlayback()
  })

  test('pipes every mic frame to engine.sendAudio, in order, with no drops', async () => {
    const { engine, sendAudioCalls } = makeEngine()
    const session = createRealtimeSession({ engine })

    await session.start()

    expect(capturedOnFrame).not.toBeNull()
    expect(micStartCalls).toBe(1)

    const values = [0.1, -0.2, 0.3, -0.4, 0.5]
    for (const value of values) {
      capturedOnFrame?.(makeFrame(value))
    }

    expect(sendAudioCalls.length).toBe(5)
    sendAudioCalls.forEach((frame, i) => {
      expect(frame).toBeInstanceOf(Int16Array)
      const expectedSample = float32ToInt16Sample(values[i]!)
      expect(frame[0]).toBe(expectedSample)
    })

    await session.stop()
    expect(micDestroyCalls).toBe(1)
  })

  test('never references createVadGate — the realtime path must not gate the mic', async () => {
    const { engine } = makeEngine()
    const session = createRealtimeSession({ engine })

    await session.start()
    capturedOnFrame?.(makeFrame(0.1))
    await session.stop()

    expect(createVadGateSpy).not.toHaveBeenCalled()
  })

  test('only forwards frames after connect() resolves', async () => {
    // Promise executors run synchronously, so `resolveConnect` is assigned by
    // the time `new Promise(...)` returns — a definite-assignment assertion
    // avoids TS narrowing the `let` back to `null` at the call site below.
    let resolveConnect!: () => void
    const { engine, sendAudioCalls } = makeEngine({
      connect: () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve
        }),
    })
    const session = createRealtimeSession({ engine })

    const starting = session.start()
    // connect() hasn't resolved yet — mic capture must not have been created.
    expect(capturedOnFrame).toBeNull()

    resolveConnect()
    await starting

    expect(capturedOnFrame).not.toBeNull()
    capturedOnFrame?.(makeFrame(0.2))
    expect(sendAudioCalls.length).toBe(1)

    await session.stop()
  })

  test('routes model audio events to the playback queue at 24 kHz', async () => {
    const audioEvent: RealtimeEvent = { type: 'audio', pcm: new Float32Array([0.5, -0.5]) }
    const { engine } = makeEngine({
      events: () =>
        (async function* () {
          yield audioEvent
        })(),
    })
    const session = createRealtimeSession({ engine })

    await session.start()
    // Let the background event-processing loop consume the yielded audio event.
    await flushMicrotasks()

    expect(enqueued.length).toBe(1)
    expect(enqueued[0]?.sampleRate).toBe(24000)
    expect(enqueued[0]?.pcm).toBe(audioEvent.pcm)

    await session.stop()
  })
})

describe('createRealtimeSession — proactive greeting + barge-in', () => {
  beforeEach(() => {
    resetMic()
    createVadGateSpy.mockClear()
    resetPlayback()
  })

  test('fires the new-chat greeting trigger exactly once after `ready`', async () => {
    const { engine, sendTextCalls } = makeEngine({
      // Emit `ready` twice to prove the greeting is a one-shot, not per-event.
      events: () =>
        (async function* () {
          yield { type: 'ready' } as RealtimeEvent
          yield { type: 'ready' } as RealtimeEvent
        })(),
    })
    const session = createRealtimeSession({ engine })

    await session.start()
    await flushMicrotasks()

    expect(sendTextCalls).toEqual(['Начни разговор: коротко поздоровайся и спроси, чем заняться.'])

    await session.stop()
  })

  test('fires the continuation greeting trigger when chat history is present', async () => {
    const { engine, sendTextCalls } = makeEngine({
      events: () =>
        (async function* () {
          yield { type: 'ready' } as RealtimeEvent
        })(),
    })
    const session = createRealtimeSession({ engine, hasChatHistory: true })

    await session.start()
    await flushMicrotasks()

    expect(sendTextCalls).toEqual(['Продолжи разговор: коротко поздоровайся и предложи, чем продолжить.'])

    await session.stop()
  })

  test('on `interrupted`, flushes queued playback (barge-in)', async () => {
    const { engine } = makeEngine({
      events: () =>
        (async function* () {
          yield { type: 'audio', pcm: new Float32Array([0.5, -0.5]) } as RealtimeEvent
          yield { type: 'interrupted' } as RealtimeEvent
        })(),
    })
    const session = createRealtimeSession({ engine })

    await session.start()
    await flushMicrotasks()

    // Audio was enqueued, then the barge-in flushed it exactly once.
    expect(enqueued.length).toBe(1)
    expect(flushCalls).toBe(1)
    expect(playing).toBe(false)

    await session.stop()
  })

  test('drain watcher returns to `listening` and terminates under fake timers', async () => {
    let states: SessionState[] = []
    const { engine } = makeEngine({
      events: () =>
        (async function* () {
          yield { type: 'audio', pcm: new Float32Array([0.1]) } as RealtimeEvent
        })(),
    })
    const session = createRealtimeSession({ engine, onState: (s) => states.push(s) })

    await session.start()
    await flushMicrotasks()
    expect(session.state).toBe('speaking')

    // Playback drains, then advance the sinon fake clock so the drain poll fires
    // and the session drops back to listening — no real wall-clock wait.
    playing = false
    getClock().tick(200)
    expect(session.state).toBe('listening')

    await session.stop()
    void states
  })
})
