/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Gemini Live realtime voice engine.
 *
 * Connects to Google's Gemini Live API via a backend WebSocket proxy
 * (`/v1/gemini-live`). The proxy injects the server-side API key so the
 * client never sees it.
 *
 * Protocol: simplified subset of the Gemini Live bidi WebSocket protocol.
 * - Client sends: JSON messages (session config, audio chunks, interrupts)
 * - Server sends: JSON events (transcript, audio, text, error)
 */

import { getLocalSetting } from '@/stores/local-settings-store'
import type { RealtimeEngine, RealtimeEvent, RealtimeSession, RealtimeSessionConfig } from './realtime-types'

const GEMINI_LIVE_PATH = '/v1/gemini-live'
const DEFAULT_VOICE = 'Kore'
const DEFAULT_MODEL = 'gemini-2.0-flash-live-001'

/** PCM16 encoding: float32 → int16 little-endian. */
const float32ToPcm16 = (float32: Float32Array): Int16Array => {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

/** Base64-encode a PCM16 buffer. */
const pcm16ToBase64 = (pcm16: Int16Array): string => {
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Decode base64 PCM16 audio to Float32Array. */
const base64ToFloat32 = (b64: string): Float32Array => {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff)
  }
  return float32
}

/** Get the backend WebSocket URL for the Gemini Live proxy. */
const getWsUrl = (cloudUrl: string): string => {
  const base = cloudUrl.replace(/^http/, 'ws').replace(/\/v1\/?$/, '')
  return `${base}${GEMINI_LIVE_PATH}`
}

export const createGeminiLiveEngine = (): RealtimeEngine => {
  let disposed = false

  return {
    id: 'gemini-live',

    load: async () => {
      if (disposed) {
        throw new Error('Engine disposed')
      }
    },

    openSession: (config: RealtimeSessionConfig): RealtimeSession => {
      const cloudUrl = getLocalSetting('cloudUrl')
      const wsUrl = getWsUrl(cloudUrl)
      const voice = config.voice || DEFAULT_VOICE
      const model = config.model || DEFAULT_MODEL

      const sessionAc = new AbortController()
      config.signal.addEventListener('abort', () => sessionAc.abort())

      const ws = new WebSocket(wsUrl)

      // Outbound audio buffer — flush every 50ms.
      let audioBuffer: Int16Array[] = []
      let flushTimer: ReturnType<typeof setInterval> | null = null

      // Inbound event queue — async iterator pattern.
      let eventResolve: ((value: IteratorResult<RealtimeEvent>) => void) | null = null
      const eventQueue: RealtimeEvent[] = []
      let wsClosed = false

      const flushAudio = () => {
        if (audioBuffer.length === 0 || ws.readyState !== WebSocket.OPEN) {
          return
        }
        const totalLen = audioBuffer.reduce((sum, f) => sum + f.length, 0)
        const merged = new Int16Array(totalLen)
        let offset = 0
        for (const frame of audioBuffer) {
          merged.set(frame, offset)
          offset += frame.length
        }
        audioBuffer = []
        ws.send(JSON.stringify({ type: 'audio', data: pcm16ToBase64(merged) }))
      }

      const pushEvent = (event: RealtimeEvent) => {
        if (eventResolve) {
          const resolve = eventResolve
          eventResolve = null
          resolve({ value: event, done: false })
        } else {
          eventQueue.push(event)
        }
      }

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'session_start',
          model,
          voice,
          system_instruction: config.systemPrompt,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          sample_rate: 16000,
        }))
        flushTimer = setInterval(flushAudio, 50)
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string)
          switch (msg.type) {
            case 'transcript':
              pushEvent({ type: 'transcript', text: msg.text, role: msg.role, isFinal: msg.is_final ?? false })
              break
            case 'audio':
              pushEvent({ type: 'audio', pcm: base64ToFloat32(msg.data), sampleRate: msg.sample_rate ?? 24000 })
              break
            case 'text':
              pushEvent({ type: 'text', text: msg.text })
              break
            case 'error':
              pushEvent({ type: 'error', error: msg.error })
              break
          }
        } catch {
          // Ignore malformed messages.
        }
      }

      ws.onerror = () => {
        pushEvent({ type: 'error', error: 'WebSocket connection failed' })
      }

      ws.onclose = () => {
        wsClosed = true
        if (flushTimer) {
          clearInterval(flushTimer)
          flushTimer = null
        }
        if (eventResolve) {
          eventResolve({ value: undefined as unknown as RealtimeEvent, done: true })
          eventResolve = null
        }
      }

      const events: AsyncIterable<RealtimeEvent> = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<RealtimeEvent>> {
              if (eventQueue.length > 0) {
                return Promise.resolve({ value: eventQueue.shift()!, done: false })
              }
              if (wsClosed) {
                return Promise.resolve({ value: undefined as unknown as RealtimeEvent, done: true })
              }
              return new Promise((resolve) => {
                eventResolve = resolve
              })
            },
          }
        },
      }

      return {
        sendAudio: (frame) => {
          if (ws.readyState !== WebSocket.OPEN || sessionAc.signal.aborted) {
            return
          }
          audioBuffer.push(float32ToPcm16(frame))
        },
        sendInterrupt: () => {
          if (ws.readyState !== WebSocket.OPEN || sessionAc.signal.aborted) {
            return
          }
          // Flush any pending audio first so the interrupt applies to what was sent.
          flushAudio()
          ws.send(JSON.stringify({ type: 'interrupt' }))
        },
        events,
        close: () => {
          sessionAc.abort()
          if (flushTimer) {
            clearInterval(flushTimer)
            flushTimer = null
          }
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close()
          }
          wsClosed = true
          if (eventResolve) {
            eventResolve({ value: undefined as unknown as RealtimeEvent, done: true })
            eventResolve = null
          }
        },
      }
    },

    dispose: () => {
      disposed = true
    },
  }
}
