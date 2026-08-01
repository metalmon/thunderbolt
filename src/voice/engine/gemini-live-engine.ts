/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Gemini Live realtime voice engine.
 *
 * Speaks Google's real **BidiGenerateContent** WebSocket protocol, connecting
 * to the backend relay at `/v1/gemini-live` (mounted in
 * `backend/src/fork/gemini-live/routes.ts`), which forwards frames verbatim
 * to `generativelanguage.googleapis.com` with the server-side API key
 * injected — the client never sees the key.
 *
 * Wire shapes (client → server):
 *  - `connect()` sends `{ setup: { model, generationConfig, systemInstruction,
 *    tools, realtimeInputConfig, inputAudioTranscription,
 *    outputAudioTranscription } }` as the very first frame.
 *  - `sendAudio()` sends `{ realtimeInput: { audio: { mimeType, data } } }`.
 *  - `sendText()` sends `{ realtimeInput: { text } }`.
 *  - `sendToolResponse()` sends `{ toolResponse: { functionResponses: [...] } }`.
 *
 * Wire shapes (server → client), parsed in `handleMessage`:
 *  - `{ setupComplete }` → `{ type: 'ready' }`.
 *  - `serverContent.modelTurn.parts[].inlineData.data` → `{ type: 'audio', pcm }`
 *    (PCM16 @ 24 kHz, base64-decoded to Float32).
 *  - `serverContent.interrupted` → `{ type: 'interrupted' }`.
 *  - `serverContent.inputTranscription` / `outputTranscription` → the
 *    matching transcript event.
 *  - `toolCall.functionCalls[]` → `{ type: 'tool_call', call }`.
 *
 * Turn detection is entirely server-side (`realtimeInputConfig.automaticActivityDetection`) —
 * this engine performs no local VAD and sends no activity-start/end signals.
 */

import { getAuthToken } from '@/lib/auth-token'
import { type GeminiLiveModel, getLocalSetting } from '@/stores/local-settings-store'
import { encodeWsBearer, wsBearerSubprotocolPrefix, wsCarrierSubprotocol } from '@shared/ws-bearer'
import type { RealtimeEngine, RealtimeEvent } from './realtime-types'

const geminiLivePath = '/v1/gemini-live'

/**
 * Prebuilt voice names available per Gemini Live model family, used by the
 * voice settings page (`src/settings/voice.tsx`) to populate the voice picker
 * and swap its options when the model changes. `half-cascade` exposes the
 * full prebuilt-voice catalog shared with the Gemini TTS API; `native-audio`
 * currently supports a smaller curated set. Source: Gemini API docs — update
 * if Google changes voice availability per model.
 */
export const geminiVoices: Record<GeminiLiveModel, string[]> = {
  'half-cascade': [
    'Autonoe',
    'Callirrhoe',
    'Puck',
    'Kore',
    'Charon',
    'Fenrir',
    'Aoede',
    'Leda',
    'Orus',
    'Zephyr',
    'Enceladus',
    'Iapetus',
    'Umbriel',
    'Algieba',
    'Despina',
    'Erinome',
    'Algenib',
    'Rasalgethi',
    'Laomedeia',
    'Achernar',
    'Alnilam',
    'Schedar',
    'Gacrux',
    'Pulcherrima',
    'Achird',
    'Zubenelgenubi',
    'Vindemiatrix',
    'Sadachbia',
    'Sadaltager',
    'Sulafat',
  ],
  'native-audio': ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'],
}

/** A Gemini function declaration — the subset of the Gemini API's
 *  `FunctionDeclaration` schema needed to advertise a callable tool
 *  (e.g. `submit_prompt`) to the model in the `setup` message. */
export type ToolDeclaration = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export type CreateGeminiLiveEngineOptions = {
  model: string
  voiceName: string
  systemInstruction: string
  tools: ToolDeclaration[]
}

/** Subset of the native `WebSocket` interface the engine depends on. Lets
 *  tests inject a fake socket that captures sent frames and injects server
 *  frames, without a real network connection. */
export type WebSocketLike = {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: (() => void) | null
}

export type WebSocketFactory = (url: string) => WebSocketLike

/**
 * Open the real backend relay socket with handshake-time bearer auth. Browsers
 * (and the Tauri webview) can't set an `Authorization` header on
 * `new WebSocket()`, and the app authenticates with a bearer token, not a
 * cookie — so the relay's `/v1/gemini-live` route (which authorizes in its WS
 * `open()` via `authorizeWsBearer`) would reject a bare socket. We carry the
 * same signed bearer the REST channel uses as a `thunderbolt.bearer.<token>`
 * subprotocol entry alongside the `thunderbolt.v1` carrier the server echoes
 * back — identical to `createProxyWebSocket` / the haystack ACP transport
 * (see `@shared/ws-bearer`). The auth entry is never echoed, so it never lands
 * on `WebSocket.protocol` or in proxy logs.
 */
const defaultWebSocketFactory: WebSocketFactory = (url) => {
  const token = getAuthToken()
  const protocols = token
    ? [wsCarrierSubprotocol, `${wsBearerSubprotocolPrefix}${encodeWsBearer(token)}`]
    : [wsCarrierSubprotocol]
  return new WebSocket(url, protocols) as unknown as WebSocketLike
}

const wsOpen = 1

/** Encode signed 16-bit PCM samples (little-endian) as base64. Reads from
 *  `byteOffset`/`byteLength` rather than assuming the array owns its whole
 *  buffer, so a subarray view into a larger buffer encodes only its own
 *  samples. */
export const pcm16ToBase64 = (pcm16: Int16Array): string => {
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Decode base64 PCM16 (little-endian) to an `Int16Array`. Copies into a
 *  fresh, element-aligned `ArrayBuffer` — an odd byte length (a malformed or
 *  truncated frame) would otherwise throw a `RangeError` when constructing an
 *  `Int16Array` view directly on the decoded bytes. */
export const base64ToInt16 = (b64: string): Int16Array => {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const alignedLen = len - (len % Int16Array.BYTES_PER_ELEMENT)
  const aligned = new ArrayBuffer(alignedLen)
  new Uint8Array(aligned).set(bytes.subarray(0, alignedLen))
  return new Int16Array(aligned)
}

/** Decode base64 PCM16 audio to a `Float32Array` normalized to `[-1, 1]`. */
export const base64ToFloat32 = (b64: string): Float32Array => {
  const int16 = base64ToInt16(b64)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff)
  }
  return float32
}

/** Build the backend relay URL for the Gemini Live proxy, with the model on
 *  the query string (selects the proxy's upstream endpoint version — v1alpha
 *  for native-audio models, v1beta otherwise — and is echoed inside the
 *  `setup` message too). */
const getWsUrl = (cloudUrl: string, model: string): string => {
  const base = cloudUrl.replace(/^http/, 'ws').replace(/\/v1\/?$/, '')
  return `${base}${geminiLivePath}?model=${encodeURIComponent(model)}`
}

/** Shape of a decoded server frame. Every field is optional — a given frame
 *  carries exactly one of `setupComplete` / `serverContent` / `toolCall`. */
type ServerMessage = {
  setupComplete?: Record<string, unknown>
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> }
    interrupted?: boolean
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
  }
  toolCall?: { functionCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> }
}

/**
 * Create a Gemini Live realtime engine. `wsFactory` is a test seam — it
 * defaults to the real `WebSocket` constructor and only needs overriding in
 * tests.
 */
export const createGeminiLiveEngine = (
  opts: CreateGeminiLiveEngineOptions,
  wsFactory: WebSocketFactory = defaultWebSocketFactory,
): RealtimeEngine => {
  let ws: WebSocketLike | null = null
  let closed = false

  // Inbound event queue — async iterator pattern (a "pump" over `ws.onmessage`):
  // `handleMessage` decodes each server frame into zero or more RealtimeEvents
  // and pushes them either straight to a waiting consumer or onto the queue.
  const eventQueue: RealtimeEvent[] = []
  let eventResolve: ((result: IteratorResult<RealtimeEvent>) => void) | null = null

  const pushEvent = (event: RealtimeEvent) => {
    if (eventResolve) {
      const resolve = eventResolve
      eventResolve = null
      resolve({ value: event, done: false })
    } else {
      eventQueue.push(event)
    }
  }

  /** Idempotent: marks the session closed and emits `{type:'closed'}` exactly once. */
  const finalize = () => {
    if (closed) {
      return
    }
    closed = true
    pushEvent({ type: 'closed' })
  }

  const handleMessage = (raw: string) => {
    let msg: ServerMessage
    try {
      msg = JSON.parse(raw) as ServerMessage
    } catch {
      return // Ignore malformed frames.
    }

    if (msg.setupComplete) {
      pushEvent({ type: 'ready' })
      return
    }

    const serverContent = msg.serverContent
    if (serverContent) {
      for (const part of serverContent.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          pushEvent({ type: 'audio', pcm: base64ToFloat32(part.inlineData.data) })
        }
      }
      if (serverContent.interrupted) {
        pushEvent({ type: 'interrupted' })
      }
      if (serverContent.inputTranscription?.text !== undefined) {
        pushEvent({ type: 'input_transcript', text: serverContent.inputTranscription.text })
      }
      if (serverContent.outputTranscription?.text !== undefined) {
        pushEvent({ type: 'output_transcript', text: serverContent.outputTranscription.text })
      }
    }

    for (const call of msg.toolCall?.functionCalls ?? []) {
      pushEvent({ type: 'tool_call', call: { id: call.id, name: call.name, args: call.args } })
    }
  }

  const events: AsyncIterable<RealtimeEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<RealtimeEvent>> {
          if (eventQueue.length > 0) {
            return Promise.resolve({ value: eventQueue.shift()!, done: false })
          }
          if (closed) {
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
    id: 'gemini-live',

    connect: () =>
      new Promise<void>((resolve, reject) => {
        const cloudUrl = getLocalSetting('cloudUrl')
        const socket = wsFactory(getWsUrl(cloudUrl, opts.model))
        ws = socket

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              setup: {
                model: opts.model,
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } } },
                },
                systemInstruction: { parts: [{ text: opts.systemInstruction }] },
                tools: [{ functionDeclarations: opts.tools }],
                // Server-side automatic activity detection only — this engine
                // never runs local VAD or sends activityStart/End signals.
                realtimeInputConfig: { automaticActivityDetection: {} },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
              },
            }),
          )
          resolve()
        }

        socket.onmessage = (event) => handleMessage(event.data)

        socket.onerror = () => {
          pushEvent({ type: 'error', message: 'WebSocket connection failed' })
          reject(new Error('WebSocket connection failed'))
        }

        socket.onclose = () => finalize()
      }),

    sendAudio: (frame) => {
      if (!ws || ws.readyState !== wsOpen) {
        return
      }
      ws.send(
        JSON.stringify({
          realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm16ToBase64(frame) } },
        }),
      )
    },

    sendText: (text) => {
      if (!ws || ws.readyState !== wsOpen) {
        return
      }
      ws.send(JSON.stringify({ realtimeInput: { text } }))
    },

    sendToolResponse: (id, name, response) => {
      if (!ws || ws.readyState !== wsOpen) {
        return
      }
      ws.send(JSON.stringify({ toolResponse: { functionResponses: [{ id, name, response }] } }))
    },

    events: () => events,

    close: () => {
      ws?.close()
      finalize()
    },
  }
}
