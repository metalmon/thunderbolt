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
 * and swap its options when the model changes. `half-cascade` (the original
 * Live API pipeline) launched with — and remains limited to — the 8 baseline
 * prebuilt voices; `native-audio` shares the full 30-voice HD catalog with
 * the Gemini TTS API (the 8 baseline voices plus 22 more). Getting this
 * backwards is load-bearing: an invalid `voiceName` errors every session for
 * that model family at `setup`. Source: Gemini Live API docs
 * (https://ai.google.dev/gemini-api/docs/live-guide, "native audio output
 * models support any of the voices available for our Text-to-Speech (TTS)
 * models") plus the TTS voice list at
 * https://ai.google.dev/gemini-api/docs/speech-generation#voices — update if
 * Google changes voice availability per model.
 */
export const geminiVoices: Record<GeminiLiveModel, string[]> = {
  'half-cascade': ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'],
  'native-audio': [
    'Puck',
    'Charon',
    'Kore',
    'Fenrir',
    'Aoede',
    'Leda',
    'Orus',
    'Zephyr',
    'Autonoe',
    'Callirrhoe',
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
}

/** A Gemini function declaration — the subset of the Gemini API's
 *  `FunctionDeclaration` schema needed to advertise a callable tool
 *  (e.g. `submit_prompt`) to the model in the `setup` message. */
export type ToolDeclaration = {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Gemini `Behavior` — set to `'NON_BLOCKING'` for native-audio/2.5 models so
   *  the tool can be called mid-conversation (see `nonBlockingTools`). */
  behavior?: 'BLOCKING' | 'NON_BLOCKING'
}

export type CreateGeminiLiveEngineOptions = {
  model: string
  voiceName: string
  systemInstruction: string
  tools: ToolDeclaration[]
  /** BCP-47 speech language (e.g. `ru-RU`) for `speechConfig.languageCode`.
   *  Set for half-cascade only — it speaks with a heavy foreign accent unless
   *  told the target language; native-audio picks the language itself and
   *  rejects the field, so `router.ts` leaves this undefined for it. */
  languageCode?: string
}

/** Subset of the native `WebSocket` interface the engine depends on. Lets
 *  tests inject a fake socket that captures sent frames and injects server
 *  frames, without a real network connection. */
export type WebSocketLike = {
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  onopen: (() => void) | null
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null
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
  const socket = new WebSocket(url, protocols)
  // Gemini streams every server frame (setupComplete and serverContent audio)
  // as a BINARY WebSocket frame. The default `binaryType` is 'blob', which
  // arrives as a Blob and silently fails the synchronous `JSON.parse` in
  // `handleMessage` — the session connects but stays mute (no audio, no
  // transcripts). Force ArrayBuffer so `connect()`'s `onmessage` decodes inline.
  socket.binaryType = 'arraybuffer'
  return socket as unknown as WebSocketLike
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

  // native-audio / 2.5 models won't call a tool mid-conversation unless its
  // declaration is NON_BLOCKING and the tool response is scheduled WHEN_IDLE —
  // otherwise they only fire it as the session ends (a known 2.5 limitation;
  // voice-cloud parity). half-cascade (3.1) uses the default blocking behavior,
  // which already works, so it's left untouched.
  const nonBlockingTools = /native-audio/.test(opts.model) || /2\.5/.test(opts.model)

  // native-audio's default thinking mode intermittently conflicts with audio
  // output — the server closes 1007 "The audio content type (CONTENT_TYPE_AUDIO)
  // is not supported for this model configuration" mid-turn and drops the
  // turn/tool-call (voice glitches, "doesn't set the task"). Disabling thinking
  // (budget 0) stabilizes it — verified 3/3 clean vs intermittent 1007 without.
  // voice-cloud parity. half-cascade (3.1) doesn't think this way and is left as-is.
  const isNativeAudio = /native-audio/.test(opts.model)

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
                // Gemini's `setup.model` requires the fully-qualified `models/…`
                // resource name — the bare id (used in the relay `?model=` query
                // for endpoint-version selection) is rejected with close 1008
                // "… is not found for API".
                model: `models/${opts.model}`,
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  temperature: 0.8,
                  speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voiceName } },
                    // Half-cascade only (see `languageCode` doc) — kills the
                    // foreign accent by naming the target speech language.
                    ...(opts.languageCode ? { languageCode: opts.languageCode } : {}),
                  },
                  // Disable thinking for native-audio (see `isNativeAudio`) —
                  // otherwise it intermittently 1007s on the audio content type.
                  ...(isNativeAudio ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
                },
                systemInstruction: { parts: [{ text: opts.systemInstruction }] },
                tools: [
                  {
                    functionDeclarations: nonBlockingTools
                      ? opts.tools.map((tool) => ({ ...tool, behavior: 'NON_BLOCKING' as const }))
                      : opts.tools,
                  },
                ],
                // Server-side automatic activity detection (this engine never runs
                // local VAD or sends activityStart/End; barge-in is entirely
                // server-decided and handled LOCALLY on the client — we never touch
                // the upstream stream, which native-audio needs kept continuous).
                // The tuning DIFFERS by model (voice-cloud parity):
                //  - native-audio: HIGH start-sensitivity so barge-in fires eagerly,
                //    plus an explicit short end-of-speech silence window — without
                //    both, interruption doesn't work and turn detection drops the
                //    stream ("слетает").
                //  - half-cascade (3.1): LOW so short sounds don't tear its reply
                //    (a known 3.1 bug); no silence window needed.
                realtimeInputConfig: {
                  automaticActivityDetection: isNativeAudio
                    ? { startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH', prefixPaddingMs: 300, silenceDurationMs: 100 }
                    : { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', prefixPaddingMs: 300 },
                },
                inputAudioTranscription: {},
                outputAudioTranscription: {},
              },
            }),
          )
          resolve()
        }

        socket.onmessage = (event) =>
          handleMessage(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data))

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
      // WHEN_IDLE lets a NON_BLOCKING tool's result surface in the model's next
      // idle moment (it voices it in a pause) rather than being dropped — pairs
      // with the NON_BLOCKING declaration above for native-audio/2.5.
      const functionResponse = nonBlockingTools
        ? { id, name, response, scheduling: 'WHEN_IDLE' as const }
        : { id, name, response }
      ws.send(JSON.stringify({ toolResponse: { functionResponses: [functionResponse] } }))
    },

    events: () => events,

    close: () => {
      ws?.close()
      finalize()
    },
  }
}
