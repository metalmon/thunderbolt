/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it } from 'bun:test'
import { useLocalSettingsStore } from '@/stores/local-settings-store'
import {
  base64ToFloat32,
  base64ToInt16,
  createGeminiLiveEngine,
  pcm16ToBase64,
  type ToolDeclaration,
  type WebSocketFactory,
  type WebSocketLike,
} from './gemini-live-engine'
import type { RealtimeEvent } from './realtime-types'

/** Fake WebSocket that captures every sent frame (parsed back to JSON) and lets
 *  tests inject server frames via `emit`. Transitions to OPEN on the next
 *  microtask after construction, mirroring real WebSocket handshake timing. */
class FakeWebSocket implements WebSocketLike {
  readyState = 0
  sentRaw: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: (() => void) | null = null

  constructor(public url: string) {
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.()
    })
  }

  send(data: string) {
    this.sentRaw.push(data)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }

  get sent(): Array<Record<string, unknown>> {
    return this.sentRaw.map((raw) => JSON.parse(raw))
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  /** Emit a server frame as a BINARY WebSocket frame (ArrayBuffer). Gemini sends
   *  every server frame this way; the engine must decode it before JSON.parse. */
  emitBinary(payload: unknown) {
    this.onmessage?.({ data: new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer })
  }
}

const submitPromptTool: ToolDeclaration = {
  name: 'submit_prompt',
  description: 'Submit the synthesized prompt to the chat agent.',
  parameters: { type: 'OBJECT', properties: { prompt: { type: 'STRING' } }, required: ['prompt'] },
}

/** Build a fresh engine + fake socket pair, wired via an injected factory. */
const buildEngine = () => {
  let socket: FakeWebSocket | null = null
  const factory: WebSocketFactory = (url) => {
    socket = new FakeWebSocket(url)
    return socket
  }
  const engine = createGeminiLiveEngine(
    {
      model: 'gemini-3.1-flash-live-preview',
      voiceName: 'Kore',
      systemInstruction: 'You are a helpful voice co-pilot.',
      tools: [submitPromptTool],
    },
    factory,
  )
  return { engine, getSocket: () => socket as unknown as FakeWebSocket }
}

/** Collect the next N events from the engine's async iterator. */
const nextEvents = async (iterable: AsyncIterable<RealtimeEvent>, count: number): Promise<RealtimeEvent[]> => {
  const iterator = iterable[Symbol.asyncIterator]()
  const events: RealtimeEvent[] = []
  for (let i = 0; i < count; i++) {
    const { value } = await iterator.next()
    events.push(value)
  }
  return events
}

describe('createGeminiLiveEngine — wire protocol', () => {
  beforeEach(() => {
    useLocalSettingsStore.setState({ cloudUrl: 'http://localhost:8000/v1' })
  })

  it('connects to /v1/gemini-live with the model on the query string', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    expect(getSocket().url).toBe('ws://localhost:8000/v1/gemini-live?model=gemini-3.1-flash-live-preview')
  })

  it('sends the setup frame first, exactly per BidiGenerateContent shape', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()

    expect(getSocket().sent).toEqual([
      {
        setup: {
          // `setup.model` carries the fully-qualified `models/…` name (the bare
          // id is rejected 1008); the `?model=` query keeps the bare id.
          model: 'models/gemini-3.1-flash-live-preview',
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature: 0.8,
            // No `languageCode` — this engine was built without one (half-cascade
            // gets it only when the caller passes it; see the languageCode test).
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          },
          systemInstruction: { parts: [{ text: 'You are a helpful voice co-pilot.' }] },
          tools: [{ functionDeclarations: [submitPromptTool] }],
          realtimeInputConfig: {
            automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', prefixPaddingMs: 300 },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      },
    ])
  })

  it('carries speechConfig.languageCode when the engine is built with one (half-cascade accent fix)', async () => {
    let socket: FakeWebSocket | null = null
    const engine = createGeminiLiveEngine(
      {
        model: 'gemini-3.1-flash-live-preview',
        voiceName: 'Kore',
        systemInstruction: 'x',
        tools: [submitPromptTool],
        languageCode: 'ru-RU',
      },
      (url) => {
        socket = new FakeWebSocket(url)
        return socket
      },
    )
    await engine.connect()
    const setup = (socket as unknown as FakeWebSocket).sent[0].setup as {
      generationConfig: { speechConfig: { languageCode?: string } }
    }
    expect(setup.generationConfig.speechConfig.languageCode).toBe('ru-RU')
  })

  it('decodes BINARY server frames — Gemini sends every frame as binary', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const pending = nextEvents(engine.events(), 1)

    // A Blob/ArrayBuffer frame that JSON.parse would choke on if not decoded.
    getSocket().emitBinary({ setupComplete: {} })

    expect(await pending).toEqual([{ type: 'ready' }])
  })

  it('sendAudio encodes an Int16Array frame as base64 PCM16 @16kHz', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const frame = new Int16Array([0, 1, -1, 32767, -32768])

    engine.sendAudio(frame)

    const sent = getSocket().sent
    expect(sent[1]).toEqual({
      realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm16ToBase64(frame) } },
    })
    expect(base64ToInt16(pcm16ToBase64(frame))).toEqual(frame)
  })

  it('sendText sends a realtimeInput.text frame', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()

    engine.sendText('hi')

    expect(getSocket().sent[1]).toEqual({ realtimeInput: { text: 'hi' } })
  })

  it('sendToolResponse sends a toolResponse.functionResponses frame', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()

    engine.sendToolResponse('1', 'submit_prompt', { status: 'ok' })

    expect(getSocket().sent[1]).toEqual({
      toolResponse: { functionResponses: [{ id: '1', name: 'submit_prompt', response: { status: 'ok' } }] },
    })
  })

  it('declares NON_BLOCKING tools + schedules WHEN_IDLE responses for native-audio (2.5 tool-call fix)', async () => {
    let socket: FakeWebSocket | null = null
    const engine = createGeminiLiveEngine(
      {
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        voiceName: 'Puck',
        systemInstruction: 'x',
        tools: [submitPromptTool],
      },
      (url) => {
        socket = new FakeWebSocket(url)
        return socket
      },
    )
    await engine.connect()
    const s = socket as unknown as FakeWebSocket
    const setup = s.sent[0].setup as {
      generationConfig: { thinkingConfig?: { thinkingBudget?: number } }
      tools: Array<{ functionDeclarations: Array<{ behavior?: string }> }>
    }
    expect(setup.tools[0].functionDeclarations[0].behavior).toBe('NON_BLOCKING')
    // Thinking disabled — otherwise native-audio intermittently 1007s on audio.
    expect(setup.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })

    engine.sendToolResponse('1', 'submit_prompt', { status: 'ok' })
    expect(s.sent[1]).toEqual({
      toolResponse: {
        functionResponses: [{ id: '1', name: 'submit_prompt', response: { status: 'ok' }, scheduling: 'WHEN_IDLE' }],
      },
    })
  })

  it('parses setupComplete into a ready event', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const pending = nextEvents(engine.events(), 1)

    getSocket().emit({ setupComplete: {} })

    expect(await pending).toEqual([{ type: 'ready' }])
  })

  it('parses inline audio data into an audio event carrying decoded PCM', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const samples = new Int16Array([100, -100, 32767, -32768, 0])
    const b64 = pcm16ToBase64(samples)
    const pending = nextEvents(engine.events(), 1)

    getSocket().emit({ serverContent: { modelTurn: { parts: [{ inlineData: { data: b64 } }] } } })

    const [event] = await pending
    expect(event.type).toBe('audio')
    if (event.type === 'audio') {
      expect(Array.from(event.pcm)).toEqual(Array.from(base64ToFloat32(b64)))
    }
  })

  it('parses serverContent.interrupted into an interrupted event', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const pending = nextEvents(engine.events(), 1)

    getSocket().emit({ serverContent: { interrupted: true } })

    expect(await pending).toEqual([{ type: 'interrupted' }])
  })

  it('parses toolCall.functionCalls into tool_call events', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const pending = nextEvents(engine.events(), 1)

    getSocket().emit({
      toolCall: { functionCalls: [{ id: 'call-1', name: 'submit_prompt', args: { prompt: 'draft a plan' } }] },
    })

    expect(await pending).toEqual([
      { type: 'tool_call', call: { id: 'call-1', name: 'submit_prompt', args: { prompt: 'draft a plan' } } },
    ])
  })

  it('parses inputTranscription and outputTranscription into transcript events', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const pending = nextEvents(engine.events(), 2)

    getSocket().emit({ serverContent: { inputTranscription: { text: 'hello there' } } })
    getSocket().emit({ serverContent: { outputTranscription: { text: 'hi, how can I help' } } })

    expect(await pending).toEqual([
      { type: 'input_transcript', text: 'hello there' },
      { type: 'output_transcript', text: 'hi, how can I help' },
    ])
  })
})

describe('PCM16 <-> base64 helpers', () => {
  it('round-trips signed 16-bit samples including extremes', () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 12345, -12345])
    expect(base64ToInt16(pcm16ToBase64(samples))).toEqual(samples)
  })

  it('honors byteOffset when encoding a subarray view into a larger buffer', () => {
    const buffer = new ArrayBuffer(12)
    const full = new Int16Array(buffer)
    full.set([1, 2, 3, 4, 5, 6])
    const view = new Int16Array(buffer, 4, 3) // samples [3, 4, 5]

    expect(base64ToInt16(pcm16ToBase64(view))).toEqual(new Int16Array([3, 4, 5]))
  })

  it('does not throw on an odd-length base64 payload — truncates to the last aligned sample', () => {
    // 5 raw bytes (odd) — decodes to 2 full Int16 samples, trailing byte dropped.
    const bytes = new Uint8Array([1, 0, 2, 0, 0xff])
    const binary = Array.from(bytes)
      .map((b) => String.fromCharCode(b))
      .join('')
    const b64 = btoa(binary)

    const decoded = base64ToInt16(b64)

    expect(decoded).toEqual(new Int16Array([1, 2]))
  })

  it('base64ToFloat32 normalizes decoded samples into [-1, 1]', () => {
    const samples = new Int16Array([32767, -32768, 0])
    const floats = base64ToFloat32(pcm16ToBase64(samples))
    expect(floats[0]).toBeCloseTo(1, 5)
    expect(floats[1]).toBeCloseTo(-1, 5)
    expect(floats[2]).toBe(0)
  })
})
