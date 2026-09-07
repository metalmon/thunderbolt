/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it } from 'bun:test'
import { clearAuthToken, setAuthToken } from '@/lib/auth-token'
import { useLocalSettingsStore } from '@/stores/local-settings-store'
import { encodeWsBearer, wsBearerSubprotocolPrefix, wsCarrierSubprotocol } from '@shared/ws-bearer'
import { encodeWsGeminiKey, wsGeminiKeySubprotocolPrefix } from '@shared/ws-gemini-key'
import {
  base64ToFloat32,
  base64ToInt16,
  createGeminiLiveEngine,
  pcm16ToBase64,
  type CreateGeminiLiveEngineDeps,
  type CreateGeminiLiveEngineOptions,
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
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  constructor(
    public url: string,
    public protocols: string[] = [],
  ) {
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
    this.onclose?.({ code: 1000, reason: '' })
  }

  /** Simulate a server-initiated close with a specific code — e.g. the relay's
   *  1008 "Gemini provider not configured" or 4001 "unauthorized". */
  emitClose(code: number, reason = '') {
    this.readyState = 3
    this.onclose?.({ code, reason })
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

/** Build a fresh engine + fake socket pair, wired via an injected factory.
 *  Defaults to relay mode (`getProxyEnabled: () => true`) — the wire-protocol
 *  tests below exercise the relay path and don't care about the routing
 *  decision itself (see the dedicated relay/direct tests further down). */
const buildEngine = (
  optsOverrides: Partial<CreateGeminiLiveEngineOptions> = {},
  depsOverrides: Partial<CreateGeminiLiveEngineDeps> = {},
) => {
  let socket: FakeWebSocket | null = null
  const factory: WebSocketFactory = (url, protocols) => {
    socket = new FakeWebSocket(url, protocols)
    return socket
  }
  const engine = createGeminiLiveEngine(
    {
      model: 'gemini-3.1-flash-live-preview',
      voiceName: 'Kore',
      systemInstruction: 'You are a helpful voice co-pilot.',
      tools: [submitPromptTool],
      ...optsOverrides,
    },
    {
      wsFactory: factory,
      // happydom doesn't run setTimeout — flush on a microtask instead.
      scheduleFlush: (flush) => queueMicrotask(flush),
      getProxyEnabled: () => true,
      ...depsOverrides,
    },
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

  it('relay: adds the gemini-key subprotocol alongside the carrier + bearer entries when a BYOK key is configured (no wire-format regression)', async () => {
    setAuthToken('test-token')
    try {
      const { engine, getSocket } = buildEngine({ geminiApiKey: 'user-key' }, { getProxyEnabled: () => true })
      await engine.connect()

      expect(getSocket().url).toBe('ws://localhost:8000/v1/gemini-live?model=gemini-3.1-flash-live-preview')
      // The carrier + bearer entries are still exactly what they were before this
      // feature existed — the gemini-key entry is purely additive.
      expect(getSocket().protocols).toEqual([
        wsCarrierSubprotocol,
        `${wsBearerSubprotocolPrefix}${encodeWsBearer('test-token')}`,
        encodeWsGeminiKey('user-key'),
      ])
    } finally {
      clearAuthToken()
    }
  })

  it('relay: omits the gemini-key subprotocol when no BYOK key is configured', async () => {
    const { engine, getSocket } = buildEngine({}, { getProxyEnabled: () => true })
    await engine.connect()

    expect(getSocket().protocols.some((p) => p.startsWith(wsGeminiKeySubprotocolPrefix))).toBe(false)
  })

  it('direct: awaits the ephemeral-token mint before opening the Google WS URL when the proxy is off', async () => {
    const callOrder: string[] = []
    let socket: FakeWebSocket | null = null
    const mintToken = async (apiKey: string, model: string): Promise<string> => {
      expect(apiKey).toBe('user-key')
      expect(model).toBe('gemini-3.1-flash-live-preview')
      callOrder.push('mint-start')
      await Promise.resolve()
      callOrder.push('mint-end')
      return 'tok-123'
    }
    const engine = createGeminiLiveEngine(
      {
        model: 'gemini-3.1-flash-live-preview',
        voiceName: 'Kore',
        systemInstruction: 'x',
        tools: [submitPromptTool],
        geminiApiKey: 'user-key',
      },
      {
        wsFactory: (url, protocols) => {
          callOrder.push('socket-created')
          socket = new FakeWebSocket(url, protocols)
          return socket
        },
        scheduleFlush: (flush) => queueMicrotask(flush),
        getProxyEnabled: () => false,
        mintToken,
      },
    )

    await engine.connect()

    expect(callOrder).toEqual(['mint-start', 'mint-end', 'socket-created'])
    expect(socket!.url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?access_token=tok-123',
    )
    expect(socket!.protocols).toEqual([])
  })

  it('direct: selects the v1alpha endpoint for native-audio models (parity with the relay)', async () => {
    let socket: FakeWebSocket | null = null
    const engine = createGeminiLiveEngine(
      {
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        voiceName: 'Puck',
        systemInstruction: 'x',
        tools: [submitPromptTool],
        geminiApiKey: 'user-key',
      },
      {
        wsFactory: (url, protocols) => {
          socket = new FakeWebSocket(url, protocols)
          return socket
        },
        scheduleFlush: (flush) => queueMicrotask(flush),
        getProxyEnabled: () => false,
        mintToken: async () => 'tok-456',
      },
    )

    await engine.connect()

    expect(socket!.url).toBe(
      'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?access_token=tok-456',
    )
  })

  it('direct: rejects connect() and emits an error event when no BYOK key is configured (no socket opened)', async () => {
    let socketCreateCount = 0
    const engine = createGeminiLiveEngine(
      { model: 'gemini-3.1-flash-live-preview', voiceName: 'Kore', systemInstruction: 'x', tools: [submitPromptTool] },
      {
        wsFactory: (url, protocols) => {
          socketCreateCount++
          return new FakeWebSocket(url, protocols)
        },
        scheduleFlush: (flush) => queueMicrotask(flush),
        getProxyEnabled: () => false,
        // No geminiApiKey — the direct path has nothing to mint a token from.
      },
    )

    await expect(engine.connect()).rejects.toThrow('Gemini API key required for the direct voice connection')

    expect(socketCreateCount).toBe(0)
    const [event] = await nextEvents(engine.events(), 1)
    expect(event).toEqual({ type: 'error', message: 'Gemini API key required for the direct voice connection' })
  })

  it('direct: rejects connect() and emits one error event when the initial ephemeral-token mint fails (no dangling socket)', async () => {
    let socketCreateCount = 0
    const engine = createGeminiLiveEngine(
      {
        model: 'gemini-3.1-flash-live-preview',
        voiceName: 'Kore',
        systemInstruction: 'x',
        tools: [submitPromptTool],
        geminiApiKey: 'user-key',
      },
      {
        wsFactory: (url, protocols) => {
          socketCreateCount++
          return new FakeWebSocket(url, protocols)
        },
        scheduleFlush: (flush) => queueMicrotask(flush),
        getProxyEnabled: () => false,
        mintToken: async () => {
          throw new Error('boom')
        },
      },
    )

    await expect(engine.connect()).rejects.toThrow('boom')

    expect(socketCreateCount).toBe(0)
    // openSocket runs its resolve/catch exactly once per call, and connect()
    // only ever calls it once for the initial attempt — so exactly one error
    // event is queued, structurally (not just observed here).
    const events = await nextEvents(engine.events(), 1)
    expect(events).toEqual([{ type: 'error', message: 'boom' }])
  })

  it('direct: retries a reconnect-time mint failure across the full budget before finalizing exactly once (does not discard the retry budget)', async () => {
    let socket: FakeWebSocket | null = null
    let mintCallCount = 0
    const maxReconnectAttempts = 8 // mirrors the engine's private constant
    const engine = createGeminiLiveEngine(
      {
        model: 'gemini-3.1-flash-live-preview',
        voiceName: 'Kore',
        systemInstruction: 'x',
        tools: [submitPromptTool],
        geminiApiKey: 'user-key',
      },
      {
        wsFactory: (url, protocols) => {
          socket = new FakeWebSocket(url, protocols)
          return socket
        },
        scheduleFlush: (flush) => queueMicrotask(flush),
        getProxyEnabled: () => false,
        mintToken: async () => {
          mintCallCount++
          if (mintCallCount === 1) {
            return 'tok-initial' // initial connect succeeds
          }
          throw new Error('transient mint failure') // every reconnect attempt fails
        },
      },
    )

    // Every failed reconnect attempt pushes its own error event (same as an
    // initial-connect failure) before scheduleReconnect decides retry vs
    // finalize, so the full sequence is `maxReconnectAttempts` error events
    // followed by exactly one 'closed' once the budget is exhausted.
    const pendingEvents = nextEvents(engine.events(), maxReconnectAttempts + 1)
    await engine.connect()

    // Mid-session drop (NOT a user close) — every subsequent reconnect's mint
    // rejects, so this exercises the retry budget rather than tearing the
    // session down on the first transient failure. `await`ing the events
    // (rather than manually flushing microtasks N times) waits exactly as
    // long as the internal retry chain actually takes — bounded because
    // `maxReconnectAttempts` is finite and every mint settles immediately
    // (no real timers involved).
    socket!.close()

    const events = await pendingEvents
    expect(events).toEqual([
      ...Array.from({ length: maxReconnectAttempts }, () => ({
        type: 'error' as const,
        message: 'transient mint failure',
      })),
      { type: 'closed' },
    ])
    expect(mintCallCount).toBe(1 + maxReconnectAttempts)
  })

  it('relay: a terminal 1008 close (no server key) surfaces an error and does NOT reconnect', async () => {
    const { engine, getSocket } = buildEngine()
    const pendingEvents = nextEvents(engine.events(), 2)
    await engine.connect() // relay accepts the upgrade → onopen fires (everOpened = true)

    // The relay accepts the WS upgrade and THEN closes 1008 in its open()
    // handler when no server key is configured. A transient-drop reconnect
    // would loop silently; instead this must surface an error and finalize.
    getSocket()!.emitClose(1008, 'Gemini provider not configured')

    const events = await pendingEvents
    expect(events).toEqual([
      { type: 'error', message: 'Gemini provider not configured' },
      { type: 'closed' },
    ])
  })

  it('direct: does not open a zombie socket when close() races a reconnect mint still in flight', async () => {
    let socketCreateCount = 0
    const sockets: FakeWebSocket[] = []
    let mintCallCount = 0
    let resolveReconnectMint: ((token: string) => void) | null = null

    const engine = createGeminiLiveEngine(
      {
        model: 'gemini-3.1-flash-live-preview',
        voiceName: 'Kore',
        systemInstruction: 'x',
        tools: [submitPromptTool],
        geminiApiKey: 'user-key',
      },
      {
        wsFactory: (url, protocols) => {
          socketCreateCount++
          const socket = new FakeWebSocket(url, protocols)
          sockets.push(socket)
          return socket
        },
        scheduleFlush: (flush) => queueMicrotask(flush),
        getProxyEnabled: () => false,
        mintToken: async () => {
          mintCallCount++
          if (mintCallCount === 1) {
            return 'tok-initial' // initial connect resolves immediately
          }
          // The reconnect's mint: a real network call on the direct path can take
          // hundreds of ms. Leave it deliberately pending so the test controls
          // exactly when it resolves relative to close().
          return new Promise<string>((resolve) => {
            resolveReconnectMint = resolve
          })
        },
      },
    )

    const pendingClosed = nextEvents(engine.events(), 1)
    await engine.connect()
    expect(socketCreateCount).toBe(1)

    // Mid-session drop (NOT a user close) starts the reconnect, which calls
    // mintToken again. That call synchronously reaches its pending Promise
    // before `close()` on a FakeWebSocket returns (no awaits needed to observe
    // this — see the sibling retry-budget test for the same synchronous chain).
    sockets[0].close()
    expect(mintCallCount).toBe(2)
    expect(resolveReconnectMint).not.toBeNull()

    // The user stops voice WHILE the reconnect's mint is still in flight — the
    // race this test exists to cover.
    engine.close()

    // Now the in-flight mint finally resolves. Without the fix, `openSocket`
    // would proceed to open a brand-new socket here — a zombie connection to
    // Google that nobody asked for, burning the user's BYOK quota and emitting
    // events past 'closed'.
    resolveReconnectMint!('tok-late')
    for (let i = 0; i < 6; i++) {
      await Promise.resolve() // drain the resumed resolveConnection/openSocket chain
    }

    expect(socketCreateCount).toBe(1) // no zombie socket was created
    expect(sockets).toHaveLength(1)
    expect(sockets[0].sent).toEqual([sockets[0].sent[0]]) // only the original setup frame — nothing sent after
    expect(await pendingClosed).toEqual([{ type: 'closed' }]) // finalize stays idempotent despite the racy double onclose
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
          // Resumption enabled from the first connect (empty handle); a reconnect
          // replays the captured handle.
          sessionResumption: {},
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
      {
        wsFactory: (url, protocols) => {
          socket = new FakeWebSocket(url, protocols)
          return socket
        },
        getProxyEnabled: () => true,
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
    await Promise.resolve() // let the coalescing microtask flush fire

    const sent = getSocket().sent
    expect(sent[1]).toEqual({
      realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: pcm16ToBase64(frame) } },
    })
    expect(base64ToInt16(pcm16ToBase64(frame))).toEqual(frame)
  })

  it('coalesces mic frames buffered before a flush into ONE audio message', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()

    engine.sendAudio(new Int16Array([1, 2, 3]))
    engine.sendAudio(new Int16Array([4, 5, 6])) // same tick → both buffered before the flush
    await Promise.resolve()

    const audioMsgs = getSocket().sent.slice(1) // sent[0] is setup
    expect(audioMsgs).toHaveLength(1)
    expect(audioMsgs[0]).toEqual({
      realtimeInput: {
        audio: { mimeType: 'audio/pcm;rate=16000', data: pcm16ToBase64(new Int16Array([1, 2, 3, 4, 5, 6])) },
      },
    })
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
      {
        wsFactory: (url, protocols) => {
          socket = new FakeWebSocket(url, protocols)
          return socket
        },
        getProxyEnabled: () => true,
      },
    )
    await engine.connect()
    const s = socket as unknown as FakeWebSocket
    const setup = s.sent[0].setup as {
      generationConfig: { thinkingConfig?: { thinkingBudget?: number } }
      realtimeInputConfig: { automaticActivityDetection: Record<string, unknown> }
      tools: Array<{ functionDeclarations: Array<{ behavior?: string }> }>
    }
    expect(setup.tools[0].functionDeclarations[0].behavior).toBe('NON_BLOCKING')
    // Thinking disabled — otherwise native-audio intermittently 1007s on audio.
    expect(setup.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
    // native-audio VAD: HIGH sensitivity (eager barge-in) + end-of-speech silence.
    expect(setup.realtimeInputConfig.automaticActivityDetection).toEqual({
      startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
      prefixPaddingMs: 300,
      silenceDurationMs: 100,
    })

    engine.sendToolResponse('1', 'submit_prompt', { status: 'ok' })
    expect(s.sent[1]).toEqual({
      toolResponse: {
        functionResponses: [{ id: '1', name: 'submit_prompt', response: { status: 'ok' }, scheduling: 'WHEN_IDLE' }],
      },
    })
  })

  it('reconnects with the captured resumption handle when the socket drops mid-session', async () => {
    const { engine, getSocket } = buildEngine()
    await engine.connect()
    const first = getSocket()

    // Server streams a resumption handle, then the socket drops (NOT a user close).
    first.emit({ sessionResumptionUpdate: { newHandle: 'HANDLE-123' } })
    first.close()

    // A fresh socket opens and replays the setup carrying the handle.
    await Promise.resolve()
    await Promise.resolve()
    const second = getSocket()
    expect(second).not.toBe(first)
    const setup = second.sent[0].setup as { sessionResumption?: { handle?: string } }
    expect(setup.sessionResumption).toEqual({ handle: 'HANDLE-123' })
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
