/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Realtime (bidi WebSocket) voice session orchestrator.
 *
 * Unlike the pipeline `createVoiceSession` (VAD → STT → LLM → TTS),
 * this session streams mic audio directly into the realtime engine's WebSocket
 * and receives events (transcripts, audio, text) from the server. The server
 * handles turn detection, STT, LLM, and TTS simultaneously.
 *
 * Barge-in: the user starts speaking → we send an interrupt message to the
 * server to stop generation, while the mic continues streaming.
 */
import { createPlaybackQueue } from '@/voice/audio/playback'
import { createVadGate } from '@/voice/audio/vad'
import type { RealtimeEngine, RealtimeEvent } from '@/voice/engine/realtime-types'
import { isHallucinatedTranscript } from '@/voice/transcript-filter'
import type { SessionState, VoiceSession } from './session'

export type RealtimeSessionOptions = {
  engine: RealtimeEngine
  systemPrompt: string
  model?: string
  voice?: string
  onState?: (state: SessionState) => void
  onTranscript?: (text: string, role: 'user' | 'assistant') => void
  onError?: (error: unknown) => void
  onLevel?: (level: number) => void
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const createRealtimeSession = (options: RealtimeSessionOptions): VoiceSession => {
  const { engine, systemPrompt, onState, onTranscript, onError, onLevel } = options
  const playback = createPlaybackQueue()
  let state: SessionState = 'idle'
  let session: ReturnType<RealtimeEngine['openSession']> | null = null
  let vadGate: Awaited<ReturnType<typeof createVadGate>> | null = null
  let stopped = false

  const setState = (next: SessionState) => {
    state = next
    vadGate?.setListening(next !== 'idle')
    onState?.(next)
  }

  /** Barge-in: user started speaking while assistant is thinking/speaking. */
  const onSpeechStart = () => {
    if (state !== 'thinking' && state !== 'speaking') {
      return
    }
    // Abort the current turn's event processing.
    turnAbort?.abort()
    playback.flush()
    setState('listening')
  }

  let turnAbort: AbortController | null = null

  /** Process events from the realtime engine's WebSocket. */
  const processEvents = async (events: AsyncIterable<RealtimeEvent>, signal: AbortSignal) => {
    try {
      for await (const event of events) {
        if (signal.aborted || stopped) {
          return
        }
        switch (event.type) {
          case 'transcript':
            if (event.role === 'user' && event.isFinal) {
              if (isHallucinatedTranscript(event.text)) {
                continue
              }
              onTranscript?.(event.text, 'user')
              setState('thinking')
            }
            if (event.role === 'assistant' && event.isFinal) {
              onTranscript?.(event.text, 'assistant')
            }
            break
          case 'audio':
            setState('speaking')
            playback.enqueue({ pcm: event.pcm, sampleRate: event.sampleRate })
            break
          case 'text':
            // Assistant text delta — optional UI display.
            break
          case 'error':
            onError?.(new Error(event.error))
            break
        }
      }
      // Events ended — wait for playback to finish.
      if (playback.isPlaying) {
        while (playback.isPlaying && !signal.aborted && !stopped) {
          await tick(80)
        }
      }
      if (!signal.aborted && !stopped) {
        setState('listening')
      }
    } catch (error) {
      if (!signal.aborted && !stopped) {
        onError?.(error)
        setState('listening')
      }
    }
  }

  const start = async () => {
    stopped = false
    await engine.load()
    if (stopped) {
      return
    }

    // Open bidi session.
    const ac = new AbortController()
    turnAbort = ac

    session = engine.openSession({
      systemPrompt,
      model: options.model ?? 'gemini-2.0-flash-live-001',
      voice: options.voice ?? 'Kore',
      signal: ac.signal,
    })

    // Start processing server events in background.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    processEvents(session.events, ac.signal)

    // Start VAD for local level metering and barge-in detection.
    const gate = await createVadGate({
      onSpeechStart,
      // For bidi, audio frames go directly to the engine — no onUtterance needed.
      onUtterance: () => {},
      onLevel,
    })
    if (stopped) {
      ac.abort()
      await gate.destroy()
      return
    }
    vadGate = gate
    await vadGate.start()
    if (stopped) {
      ac.abort()
      await vadGate.destroy()
      vadGate = null
      return
    }
    setState('listening')
  }

  const stop = async () => {
    stopped = true
    turnAbort?.abort()
    turnAbort = null
    session?.close()
    session = null
    playback.close()
    engine.dispose()
    await vadGate?.destroy()
    vadGate = null
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
