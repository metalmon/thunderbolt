/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Realtime (bidi WebSocket) voice session orchestrator.
 *
 * Unlike the pipeline `createVoiceSession` (VAD → STT → LLM → TTS), this
 * session streams mic audio directly into the realtime engine's WebSocket and
 * receives events (transcripts, audio, tool calls) from the server, which
 * handles turn detection, STT, LLM, and TTS itself.
 *
 * HARD INVARIANT: the mic is never gated, muted, or paused. Every captured
 * frame is forwarded to `engine.sendAudio` continuously from `start()` until
 * `stop()` — there is no local VAD/endpointer on this path (that's
 * `createVadGate`, used only by the pipeline session). Turn detection and
 * barge-in are entirely server-side (see `gemini-live-engine.ts`'s
 * `automaticActivityDetection`); this file only pipes audio in and renders
 * events out.
 *
 * Scope note: the `engine` passed in is already fully configured (model,
 * voice, system prompt, tools) at construction time (see `engine/router.ts`)
 * — `connect()` takes no session-level config. Proactive-greeting / barge-in
 * on `{type:'interrupted'}` and `submit_prompt` tool-call handling are left as
 * TODOs below (later tasks); this task only wires the continuous mic path and
 * a minimal, compiling event consumer.
 */
import { createPlaybackQueue } from '@/voice/audio/playback'
import { createMicCapture } from '@/voice/audio/mic-capture'
import type { RealtimeEngine, RealtimeEvent } from '@/voice/engine/realtime-types'
import { isHallucinatedTranscript } from '@/voice/transcript-filter'
import type { SessionState, VoiceSession } from './session'

/** Sample rate Gemini Live returns model audio at (see `gemini-live-engine.ts`). */
const modelAudioSampleRate = 24000

export type RealtimeSessionOptions = {
  engine: RealtimeEngine
  onState?: (state: SessionState) => void
  onTranscript?: (text: string, role: 'user' | 'assistant') => void
  onError?: (error: unknown) => void
  /** Live mic level [0,1] per frame — for the reactive waveform. */
  onLevel?: (level: number) => void
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Frame RMS — a plain amplitude measurement, not endpointing (no gating decision
 *  is made from it; it only drives the live waveform). */
const frameRms = (frame: Float32Array): number => {
  let sum = 0
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i]
  }
  return Math.sqrt(sum / frame.length)
}

/** Quantize a 16 kHz mono float frame ([-1,1]) to signed PCM16 for `sendAudio`. */
const float32ToInt16 = (frame: Float32Array): Int16Array => {
  const pcm16 = new Int16Array(frame.length)
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i]))
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return pcm16
}

export const createRealtimeSession = (options: RealtimeSessionOptions): VoiceSession => {
  const { engine, onState, onTranscript, onError, onLevel } = options
  const playback = createPlaybackQueue()
  let state: SessionState = 'idle'
  let mic: ReturnType<typeof createMicCapture> | null = null
  let drainWatch: Promise<void> | null = null
  let stopped = false

  const setState = (next: SessionState) => {
    state = next
    onState?.(next)
  }

  /** Once queued model audio finishes playing, drop back to `listening` — a
   *  single idempotent watcher per speaking spell (not a barge-in mechanism;
   *  see the `interrupted` TODO below for that). */
  const watchDrain = () => {
    if (drainWatch) {
      return
    }
    drainWatch = (async () => {
      while (playback.isPlaying && !stopped) {
        await tick(80)
      }
      drainWatch = null
      if (!stopped && state === 'speaking') {
        setState('listening')
      }
    })()
  }

  /** Every mic frame reaches the engine unconditionally — no gating, ever. */
  const onFrame = (frame: Float32Array) => {
    onLevel?.(frameRms(frame))
    engine.sendAudio(float32ToInt16(frame))
  }

  const processEvents = async (events: AsyncIterable<RealtimeEvent>) => {
    try {
      for await (const event of events) {
        if (stopped) {
          return
        }
        switch (event.type) {
          case 'ready':
            break
          case 'audio':
            setState('speaking')
            playback.enqueue({ pcm: event.pcm, sampleRate: modelAudioSampleRate })
            watchDrain()
            break
          case 'input_transcript':
            if (!isHallucinatedTranscript(event.text)) {
              onTranscript?.(event.text, 'user')
            }
            break
          case 'output_transcript':
            onTranscript?.(event.text, 'assistant')
            break
          case 'interrupted':
            // TODO(Task 6): barge-in — the server signals the user interrupted
            // the model's turn; flush queued playback and return to listening.
            break
          case 'tool_call':
            // TODO(Task 7): submit_prompt / tool handling — dispatch event.call
            // and reply via engine.sendToolResponse once the tool contract lands.
            break
          case 'error':
            onError?.(new Error(event.message))
            break
          case 'closed':
            if (!stopped) {
              setState('idle')
            }
            return
        }
      }
    } catch (error) {
      if (!stopped) {
        onError?.(error)
      }
    }
  }

  const start = async () => {
    stopped = false
    await engine.connect()
    if (stopped) {
      return
    }

    // Process server events in the background for the lifetime of the session.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    processEvents(engine.events())

    const capture = createMicCapture(onFrame)
    await capture.start()
    if (stopped) {
      await capture.destroy()
      return
    }
    mic = capture
    setState('listening')
  }

  const stop = async () => {
    stopped = true
    engine.close()
    playback.close()
    await mic?.destroy()
    mic = null
    setState('idle')
  }

  return {
    start,
    stop,
    get state() {
      return state
    },
    getOutputLevel: () => playback.getLevel(),
  }
}
