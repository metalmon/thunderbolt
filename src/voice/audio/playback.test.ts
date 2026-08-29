/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import type { AudioChunk } from '@/voice/engine/types'

import { createPlaybackQueue } from './playback'

const RATE = 24000

/** A minimal fake AudioContext with a manually-driven clock, recording the
 *  start time of every scheduled source so tests can assert the buffer's
 *  hold/drain decisions without real audio hardware. */
const makeFakeCtx = () => {
  let now = 0
  const starts: number[] = []
  const ctx = {
    get currentTime() {
      return now
    },
    destination: {},
    createAnalyser: () => ({
      fftSize: 0,
      connect: () => {},
      getFloatTimeDomainData: () => {},
    }),
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      copyToChannel: () => {},
    }),
    createBufferSource: () => ({
      buffer: null,
      connect: () => {},
      start: (t: number) => {
        starts.push(t)
      },
      stop: () => {},
      disconnect: () => {},
      onended: null as (() => void) | null,
    }),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }
  return {
    ctx: ctx as unknown as AudioContext,
    starts,
    setNow: (t: number) => {
      now = t
    },
  }
}

/** A chunk of `seconds` of (silent) audio at 24 kHz. */
const chunk = (seconds: number): AudioChunk => ({
  pcm: new Float32Array(Math.round(seconds * RATE)),
  sampleRate: RATE,
})

let warn: ReturnType<typeof spyOn>

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe('playback jitter buffer', () => {
  test('holds playout until the prefill target (250 ms) fills, then drains contiguously', () => {
    const { ctx, starts } = makeFakeCtx()
    const q = createPlaybackQueue(ctx)

    q.enqueue(chunk(0.1))
    q.enqueue(chunk(0.1)) // 200 ms < 250 ms target → still holding
    expect(starts.length).toBe(0)
    expect(q.isPlaying).toBe(true) // queued audio counts as busy

    q.enqueue(chunk(0.1)) // 300 ms ≥ 250 ms → start, drain all three
    expect(starts.length).toBe(3)
    // Contiguous from the clock (0): 0, 0.1, 0.2.
    expect(starts[0]).toBeCloseTo(0, 5)
    expect(starts[1]).toBeCloseTo(0.1, 5)
    expect(starts[2]).toBeCloseTo(0.2, 5)
  })

  test('a mid-turn underrun re-holds for the smaller resume target and is counted', () => {
    const { ctx, starts, setNow } = makeFakeCtx()
    const q = createPlaybackQueue(ctx)

    q.enqueue(chunk(0.1))
    q.enqueue(chunk(0.1))
    q.enqueue(chunk(0.1)) // starts playing; nextStartTime = 0.3
    expect(starts.length).toBe(3)

    setNow(0.4) // playhead passed 0.3 by 100 ms (< 1 s cold-gap) → underrun
    q.enqueue(chunk(0.1)) // 100 ms < 120 ms resume target → re-hold, nothing new
    expect(starts.length).toBe(3)
    expect(warn).toHaveBeenCalledTimes(1)

    q.enqueue(chunk(0.1)) // 200 ms ≥ 120 ms resume → resume, drain both
    expect(starts.length).toBe(5)
    expect(starts[3]).toBeCloseTo(0.4, 5) // resumes from the current clock
    expect(starts[4]).toBeCloseTo(0.5, 5)
  })

  test('a large drain gap is a fresh turn: re-arms full prefill, not counted as underrun', () => {
    const { ctx, starts, setNow } = makeFakeCtx()
    const q = createPlaybackQueue(ctx)

    q.enqueue(chunk(0.1))
    q.enqueue(chunk(0.1))
    q.enqueue(chunk(0.1)) // playing; nextStartTime = 0.3
    expect(starts.length).toBe(3)

    setNow(2.0) // 1.7 s past the playhead → new turn, not a stall
    q.enqueue(chunk(0.1)) // < 250 ms full prefill → holds again
    expect(starts.length).toBe(3)
    expect(warn).not.toHaveBeenCalled() // cold gap must not count as underrun
  })

  test('flush re-arms the full prefill for the next turn', () => {
    const { ctx, starts } = makeFakeCtx()
    const q = createPlaybackQueue(ctx)

    q.enqueue(chunk(0.1))
    q.enqueue(chunk(0.1))
    q.enqueue(chunk(0.1)) // playing
    expect(starts.length).toBe(3)

    q.flush()
    expect(q.isPlaying).toBe(false)

    q.enqueue(chunk(0.1)) // 100 ms < 250 ms → must re-hold, not resume-hold
    q.enqueue(chunk(0.1)) // 200 ms < 250 ms → still holding
    expect(starts.length).toBe(3) // nothing new scheduled yet
    q.enqueue(chunk(0.1)) // 300 ms ≥ 250 ms → drains
    expect(starts.length).toBe(6)
  })
})
