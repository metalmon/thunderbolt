/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Downlink jitter buffer + gapless playback (THU-684).
 *
 * Schedules model audio chunks back-to-back on a Web Audio graph routed to the
 * **default output** — that placement is what lets the browser/OS AEC use our
 * playout as its echo reference (so the mic doesn't hear the assistant and
 * self-trigger barge-in), even when the PCM was produced natively. `flush()`
 * stops everything immediately (<100 ms) for barge-in.
 *
 * Hold-and-drain jitter buffer (ported from kutsu's `bridge::pace::Downlink`).
 * The model — half-cascade especially (STT→LLM→TTS) — delivers audio in bursts
 * with gaps. Committing each chunk to the audio timeline the instant it arrives
 * starves the WebView audio stack between bursts on constrained devices
 * (mobile), and the underrun surfaces as a tonal buzz. Instead we HOLD (buffer
 * silently) until `PREBUFFER_SEC` of real audio has accumulated, then
 * batch-schedule it — so the playhead always leads arrivals by a cushion of
 * buffered data. If playout drains mid-turn we re-hold for a smaller
 * `RESUME_SEC` refill (a brief stall shouldn't re-add full onset latency); a
 * large gap is treated as a fresh turn and re-arms the full prefill.
 */
import type { AudioChunk } from '@/voice/engine/types'

/** Audio buffered before playout (re)starts. Mirrors kutsu's downlink
 *  `prebuffer_ms`: LAN/test 140 ms, real carrier→mobile 800 ms. We sit toward
 *  the low end — a backend WebSocket has far less jitter than a PSTN trunk —
 *  but above LAN, since mobile WebView playout has looser timing. Adds this
 *  much latency to speech onset; the floor at which mobile stops glitching. */
const PREBUFFER_SEC = 0.25
/** Smaller refill after a mid-turn underrun (kutsu `resume_ms`) so a brief
 *  stall doesn't re-add the full prefill latency. */
const RESUME_SEC = 0.12
/** A drain gap larger than this is a new turn, not a mid-turn stall: re-arm the
 *  full prefill and don't count it as an underrun. */
const COLD_GAP_SEC = 1.0

export type PlaybackQueue = {
  /** Schedule a chunk to play after whatever is already queued. */
  enqueue: (chunk: AudioChunk) => void
  /** Stop and drop all scheduled/playing audio immediately (barge-in). */
  flush: () => void
  /** Permanently release the audio graph — closes the owned AudioContext. */
  close: () => void
  /** Current output RMS (~[0,1]) of what's playing, for the reactive waveform;
   *  0 when nothing is queued. */
  getLevel: () => number
  readonly isPlaying: boolean
  readonly audioContext: AudioContext
}

export const createPlaybackQueue = (audioContext?: AudioContext): PlaybackQueue => {
  const ctx = audioContext ?? new AudioContext()
  const ownsCtx = !audioContext // only close a context we created
  const active = new Set<AudioBufferSourceNode>()
  // Tap the output so the waveform can react to the assistant's actual voice.
  // Sources route through the analyser to `destination`, which passes audio
  // through unchanged — so the browser/OS AEC still sees our playout as its echo
  // reference (see the module note), it just also feeds level readings.
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  analyser.connect(ctx.destination)
  const levelBuf = new Float32Array(analyser.fftSize)

  // Jitter-buffer state.
  const pending: AudioChunk[] = [] // buffered, not yet scheduled (held for prefill)
  let playing = false // true once a prefill target was met and we're draining
  let fillTargetSec = PREBUFFER_SEC // current prefill target (prebuffer vs resume)
  let nextStartTime = 0 // audio-clock time the next scheduled chunk starts at
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let underruns = 0
  let closed = false

  const pendingDurationSec = () =>
    pending.reduce((sum, chunk) => sum + chunk.pcm.length / chunk.sampleRate, 0)

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
  }

  /** Bound the prefill hold so a short utterance (< prefill target) still plays
   *  after at most `fillTargetSec`, instead of waiting forever for data that
   *  never comes. */
  const armHoldTimer = () => {
    if (holdTimer !== null) {
      return
    }
    holdTimer = setTimeout(() => {
      holdTimer = null
      pump(true)
    }, fillTargetSec * 1000)
  }

  /** Schedule one buffered chunk at `nextStartTime`, advancing it. */
  const schedule = (chunk: AudioChunk) => {
    const buffer = ctx.createBuffer(1, chunk.pcm.length, chunk.sampleRate)
    buffer.copyToChannel(new Float32Array(chunk.pcm), 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(analyser)
    source.start(nextStartTime)
    nextStartTime += buffer.duration
    active.add(source)
    source.onended = () => active.delete(source)
  }

  /** Advance the buffer state machine: hold for prefill, or drain the queue. */
  const pump = (force = false) => {
    if (!playing) {
      if (pending.length === 0) {
        return
      }
      if (!force && pendingDurationSec() < fillTargetSec) {
        armHoldTimer() // keep holding until the target fills or the timer fires
        return
      }
      // Prefill met (or hold timed out): start draining from now. `pending`
      // already holds the cushion, so the playhead leads real arrivals.
      clearHoldTimer()
      playing = true
      nextStartTime = ctx.currentTime
    } else if (nextStartTime <= ctx.currentTime) {
      // The audio timeline drained while we thought we were playing.
      const gap = ctx.currentTime - nextStartTime
      const cold = gap > COLD_GAP_SEC
      if (!cold) {
        underruns++
        console.warn(
          `[voice-playback] underrun #${underruns}: playhead gap ${(gap * 1000).toFixed(0)}ms — re-buffering ${(RESUME_SEC * 1000).toFixed(0)}ms`,
        )
      }
      // Cold gap = fresh turn (full prefill); warm gap = mid-turn stall (resume).
      playing = false
      fillTargetSec = cold ? PREBUFFER_SEC : RESUME_SEC
      armHoldTimer()
      return
    }
    while (pending.length > 0) {
      schedule(pending.shift() as AudioChunk)
    }
  }

  const enqueue = (chunk: AudioChunk) => {
    void ctx.resume() // no-op once running; needed after the user-gesture start
    pending.push(chunk)
    pump()
  }

  const getLevel = (): number => {
    if (active.size === 0) {
      return 0 // nothing playing — don't report residual analyser data
    }
    analyser.getFloatTimeDomainData(levelBuf)
    let sum = 0
    for (let i = 0; i < levelBuf.length; i++) {
      sum += levelBuf[i] * levelBuf[i]
    }
    return Math.sqrt(sum / levelBuf.length)
  }

  const flush = () => {
    clearHoldTimer()
    pending.length = 0
    for (const source of active) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // already stopped/ended — fine
      }
      source.disconnect()
    }
    active.clear()
    // Barge-in / reset: re-arm a full prefill for the next turn (kutsu `clear`).
    playing = false
    fillTargetSec = PREBUFFER_SEC
    nextStartTime = 0
  }

  const close = () => {
    if (closed) {
      return
    } // ctx.close() throws if called twice
    closed = true
    flush()
    if (ownsCtx) {
      void ctx.close()
    }
  }

  return {
    enqueue,
    flush,
    close,
    getLevel,
    get isPlaying() {
      return active.size > 0 || pending.length > 0
    },
    audioContext: ctx,
  }
}
