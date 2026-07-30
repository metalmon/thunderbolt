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

/** Tool call from the server (e.g., submit_prompt, execute_code). */
export type RealtimeToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
}

/** Events emitted by a realtime engine. */
export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'audio'; pcm: Float32Array }
  | { type: 'input_transcript'; text: string }
  | { type: 'output_transcript'; text: string }
  | { type: 'interrupted' }
  | { type: 'tool_call'; call: RealtimeToolCall }
  | { type: 'error'; message: string }
  | { type: 'closed' }

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
  id: string
  connect(): Promise<void>
  sendAudio(frame: Int16Array): void
  sendText(text: string): void
  sendToolResponse(id: string, name: string, response: Record<string, unknown>): void
  events(): AsyncIterable<RealtimeEvent>
  close(): void
}
