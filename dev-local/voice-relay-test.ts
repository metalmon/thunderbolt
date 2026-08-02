/**
 * Standalone Gemini Live voice-relay debug harness (fork/dev tooling).
 *
 * Models the browser voice engine (`src/voice/engine/gemini-live-engine.ts`)
 * end-to-end against the running backend relay (`/v1/gemini-live`) WITHOUT
 * rebuilding the Tauri binary — so the streaming path can be debugged in a tight
 * loop. Mirrors the engine's frame handling exactly, including the binary-frame
 * decode: Gemini streams `serverContent` (audio) as BINARY WebSocket frames, and
 * a browser delivers those as a `Blob` under the default `binaryType`, which
 * silently fails the synchronous `JSON.parse` in `handleMessage`. The fix (under
 * test here) is `binaryType = 'arraybuffer'` + `TextDecoder` before parsing.
 *
 * Usage (repo root, backend up on :8000):
 *   VOICE_BEARER_SUBPROTOCOL='thunderbolt.bearer.<encoded>' \
 *     bun dev-local/voice-relay-test.ts
 * The bearer subprotocol entry is the `thunderbolt.bearer.*` value from a live
 * `sec-websocket-protocol` request header (DevTools → gemini-live → Headers).
 */

const CLOUD_URL = process.env.VOICE_CLOUD_URL ?? 'http://localhost:8000/v1'
const MODEL = process.env.VOICE_MODEL ?? 'gemini-3.1-flash-live-preview'
const VOICE_NAME = process.env.VOICE_NAME ?? 'Puck'
const CARRIER = 'thunderbolt.v1'
const bearerSubprotocol = process.env.VOICE_BEARER_SUBPROTOCOL

if (!bearerSubprotocol) {
  console.error('Set VOICE_BEARER_SUBPROTOCOL (the thunderbolt.bearer.<encoded> entry from a live request).')
  process.exit(1)
}

/** Mirror of `getWsUrl()` in the engine: http→ws, strip the trailing /v1, append
 *  the relay path with the bare model id on the query (endpoint-version select). */
const getWsUrl = (cloudUrl: string, model: string): string => {
  const base = cloudUrl.replace(/^http/, 'ws').replace(/\/v1\/?$/, '')
  return `${base}/v1/gemini-live?model=${encodeURIComponent(model)}`
}

const url = getWsUrl(CLOUD_URL, MODEL)
console.log('[test] connecting', url)

const socket = new WebSocket(url, [CARRIER, bearerSubprotocol])
// THE FIX under test — Gemini's serverContent frames are binary; without this the
// browser hands `handleMessage` a Blob and JSON.parse fails silently (no audio).
socket.binaryType = 'arraybuffer'

let ready = false
let audioFrames = 0
let audioBytes = 0
let outTranscript = ''
let finished = false

const finish = () => {
  if (finished) return
  finished = true
  console.log(
    `[test] RESULT ready=${ready} audioFrames=${audioFrames} audioBytes=${audioBytes} transcript=${JSON.stringify(outTranscript.slice(0, 160))}`,
  )
  process.exit(0)
}

/** Mirror of the engine's `handleMessage(raw: string)`. */
const handleMessage = (raw: string) => {
  let m: {
    setupComplete?: unknown
    serverContent?: {
      modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> }
      outputTranscription?: { text?: string }
    }
  }
  try {
    m = JSON.parse(raw)
  } catch {
    console.log('[test] non-JSON frame len=', raw.length)
    return
  }
  if (m.setupComplete) {
    ready = true
    console.log('[test] setupComplete → sending text turn')
    socket.send(JSON.stringify({ realtimeInput: { text: 'Привет! Скажи короткое приветствие по-русски.' } }))
    setTimeout(finish, 7000)
    return
  }
  if (m.serverContent) {
    for (const part of m.serverContent.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        audioFrames++
        audioBytes += atob(part.inlineData.data).length
      }
    }
    if (m.serverContent.outputTranscription?.text) {
      outTranscript += m.serverContent.outputTranscription.text
    }
  }
}

socket.onopen = () => {
  console.log('[test] socket open → sending setup')
  socket.send(
    JSON.stringify({
      setup: {
        // Gemini's setup.model needs the fully-qualified `models/…` name.
        model: `models/${MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: 0.8,
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
        },
        systemInstruction: {
          parts: [{ text: 'Ты голосовой ассистент. Отвечай одним коротким предложением по-русски.' }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'submit_prompt',
                description: 'finalized request',
                parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
              },
            ],
          },
        ],
        realtimeInputConfig: {
          automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', prefixPaddingMs: 300 },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    }),
  )
}

socket.onmessage = (event: MessageEvent) => {
  const data = event.data
  const isBinary = typeof data !== 'string'
  if (isBinary && audioFrames === 0) {
    console.log('[test] first binary frame received (decoding via TextDecoder)')
  }
  handleMessage(isBinary ? new TextDecoder().decode(data as ArrayBuffer) : (data as string))
}

socket.onerror = (event) => console.log('[test] socket error', (event as { message?: string })?.message ?? '')
socket.onclose = (event) => {
  console.log(`[test] socket close ${event.code} ${event.reason}`)
  finish()
}

setTimeout(() => {
  console.log('[test] overall timeout')
  finish()
}, 20000)
