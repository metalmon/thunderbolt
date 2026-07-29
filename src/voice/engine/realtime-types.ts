/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Realtime (bidi WebSocket) voice engine interface.
 *
 * Unlike the pipeline {@link VoiceEngine} (separate STT → LLM → TTS steps),
 * a realtime engine runs STT, LLM, and TTS *simultaneously* over a single
 * WebSocket connection. The server handles turn detection, transcription,
 * generation, and synthesis — the client streams mic audio in and receives
 * events out.
 */

/** Events emitted by a realtime engine session. */
export type RealtimeEvent =
  | { type: 'transcript'; text: string; role: 'user' | 'assistant'; isFinal: boolean }
  | { type: 'audio'; pcm: Float32Array; sampleRate: number }
  | { type: 'text'; text: string }
  | { type: 'error'; error: string }

/** Configuration for a realtime engine session. */
export type RealtimeSessionConfig = {
  systemPrompt: string
  model: string
  voice: string
  signal: AbortSignal
}

/** A live bidi WebSocket session. */
export type RealtimeSession = {
  /** Send captured mic frames (16 kHz mono float PCM). */
  sendAudio: (frame: Float32Array) => void
  /** Send an interrupt signal to stop server-side generation/synthesis. */
  sendInterrupt: () => void
  /** Receive events from the server. */
  events: AsyncIterable<RealtimeEvent>
  /** Gracefully close the session. */
  close: () => void
}

/**
 * Realtime (bidi WebSocket) voice engine.
 *
 * This is a *separate* interface from `VoiceEngine` — the two are
 * structurally incompatible (pipeline vs bidi). The session layer picks one
 * or the other based on the engine type.
 */
export type RealtimeEngine = {
  readonly id: string
  /** Load and warm the engine. Idempotent. */
  load: () => Promise<void>
  /** Open a bidi session. Caller streams audio in and reads events out. */
  openSession: (config: RealtimeSessionConfig) => RealtimeSession
  /** Release resources. */
  dispose: () => void
}
