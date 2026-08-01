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
 * — `connect()` takes no session-level config. Once the engine emits
 * `{type:'ready'}` the session fires a one-shot proactive greeting so the model
 * speaks first, routes model `{type:'audio'}` to playback, and flushes playback
 * on `{type:'interrupted'}` (server-signalled barge-in). `submit_prompt`
 * tool-calls (Task 7) hand the synthesized prompt to the normal chat agent as
 * a real, ephemeral-to-voice chat turn — see `handleToolCall` below.
 */
import { setActiveVoiceSpeaker } from '@/voice/active-speaker'
import { createPlaybackQueue } from '@/voice/audio/playback'
import { createMicCapture } from '@/voice/audio/mic-capture'
import type { ReplyChat } from '@/voice/chat-reply'
import type { RealtimeEngine, RealtimeEvent, RealtimeToolCall } from '@/voice/engine/realtime-types'
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
  /** True when the chat already has history — selects the continuation greeting
   *  trigger instead of the fresh-start one (the chat history itself reaches the
   *  model via the system prompt, threaded in a later task). */
  hasChatHistory?: boolean
  /** The active chat instance — a `submit_prompt` tool-call routes its
   *  synthesized prompt into this as a real (but voice-ephemeral) chat turn.
   *  Optional so tests/callers without a chat context can omit it. */
  chat?: ReplyChat
}

/** Poll interval used to detect when queued model audio has finished playing. */
const drainPollMs = 80

/** The proactive-greeting trigger: a text turn that tells the model to speak
 *  first. New chat → open cold; existing chat → open as a continuation (the
 *  model already has the conversation as context via its system prompt). */
const greetingTrigger = (hasChatHistory: boolean): string =>
  hasChatHistory
    ? 'Продолжи разговор: коротко поздоровайся и предложи, чем продолжить.'
    : 'Начни разговор: коротко поздоровайся и спроси, чем заняться.'

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
  const { engine, onState, onTranscript, onError, onLevel, hasChatHistory = false, chat } = options
  const playback = createPlaybackQueue()
  let state: SessionState = 'idle'
  let mic: ReturnType<typeof createMicCapture> | null = null
  let drainTimer: ReturnType<typeof setTimeout> | null = null
  let greeted = false
  let stopped = false

  const setState = (next: SessionState) => {
    state = next
    onState?.(next)
  }

  /** Cancel any in-flight drain poll (on barge-in or stop). */
  const stopDrainWatch = () => {
    if (drainTimer !== null) {
      clearTimeout(drainTimer)
      drainTimer = null
    }
  }

  /** Once queued model audio finishes playing, drop back to `listening`. A
   *  self-rescheduling timer (not an awaited wall-clock loop, so it stays
   *  cancellable and fake-timer-safe) that runs at most once per speaking
   *  spell. Barge-in is handled separately by the `interrupted` event. */
  const watchDrain = () => {
    if (drainTimer !== null) {
      return
    }
    const poll = () => {
      if (stopped || !playback.isPlaying) {
        drainTimer = null
        if (!stopped && state === 'speaking') {
          setState('listening')
        }
        return
      }
      drainTimer = setTimeout(poll, drainPollMs)
    }
    drainTimer = setTimeout(poll, drainPollMs)
  }

  /** Every mic frame reaches the engine unconditionally — no gating, ever. */
  const onFrame = (frame: Float32Array) => {
    onLevel?.(frameRms(frame))
    engine.sendAudio(float32ToInt16(frame))
  }

  /**
   * Route a server tool-call. Only `submit_prompt` is handled today — it
   * hands the model's synthesized request to the normal chat agent as a real
   * chat turn, exactly like a typed message. This is fire-and-forget: the
   * tool response acks immediately rather than waiting on the full chat
   * completion, so Gemini's own turn isn't held open for however long the
   * chat agent takes to answer, and the assistant's reply surfaces in the
   * chat UI on its own — never routed back through this session's TTS/audio
   * path. That keeps voice turns from producing any chat message beyond this
   * single hand-off (ephemeral).
   */
  const handleToolCall = (call: RealtimeToolCall) => {
    if (call.name !== 'submit_prompt') {
      return
    }
    const prompt = typeof call.args.prompt === 'string' ? call.args.prompt : ''
    void chat?.sendMessage({ text: prompt }).catch((error) => onError?.(error))
    engine.sendToolResponse(call.id, 'submit_prompt', { status: 'ok' })
  }

  const processEvents = async (events: AsyncIterable<RealtimeEvent>) => {
    try {
      for await (const event of events) {
        if (stopped) {
          return
        }
        switch (event.type) {
          case 'ready':
            // Proactive greeting: fire a one-shot text turn so the model speaks
            // first (no user turn required). Exactly once per session.
            if (!greeted) {
              greeted = true
              engine.sendText(greetingTrigger(hasChatHistory))
            }
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
            // Barge-in: the server signals the user interrupted the model's
            // turn. Drop all queued/playing model audio immediately and return
            // to listening.
            stopDrainWatch()
            playback.flush()
            if (!stopped) {
              setState('listening')
            }
            break
          case 'tool_call':
            handleToolCall(event.call)
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
    // Register this engine as the target for `<widget:say>` tags the chat agent
    // emits while this voice session is live (see `active-speaker.ts`) — the
    // widget executor reaches it through that registry, not a direct reference.
    setActiveVoiceSpeaker({ sendText: (text) => engine.sendText(text) })
    setState('listening')
  }

  const stop = async () => {
    stopped = true
    setActiveVoiceSpeaker(null)
    stopDrainWatch()
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
