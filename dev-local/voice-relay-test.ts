/**
 * Standalone Gemini Live voice-relay debug harness (fork/dev tooling).
 *
 * Models the browser voice engine (`src/voice/engine/gemini-live-engine.ts`)
 * end-to-end against the running backend relay (`/v1/gemini-live`) WITHOUT
 * rebuilding the Tauri binary, so the streaming + tool-calling path can be
 * debugged in a tight loop.
 *
 * Verifies:
 *  - binary-frame decode (Gemini streams every server frame as binary; the
 *    browser hands it back as a Blob → set binaryType='arraybuffer' + decode).
 *  - tool-calling: drives the model to call `submit_prompt` and reports the call.
 *  - context continuity: a follow-up turn that references the first.
 *
 * Toggles (env) — used to isolate why native-audio drops context / won't call
 * the tool, matching voice-cloud's working config:
 *  - VOICE_MODEL          default native-audio; set half-cascade to compare.
 *  - SCHEMA_UPPER=1       tool Schema types UPPERCASE (OBJECT/STRING) — voice-cloud.
 *  - THINKING0=1          generationConfig.thinkingConfig.thinkingBudget = 0.
 *  - RESUMPTION=1         setup.sessionResumption = {} (context continuity handle).
 *
 * Usage (repo root, backend up on :8000):
 *   VOICE_BEARER_SUBPROTOCOL='thunderbolt.bearer.<encoded>' [SCHEMA_UPPER=1] \
 *     bun dev-local/voice-relay-test.ts
 */

const CLOUD_URL = process.env.VOICE_CLOUD_URL ?? 'http://localhost:8000/v1'
const MODEL = process.env.VOICE_MODEL ?? 'gemini-2.5-flash-native-audio-preview-12-2025'
const VOICE_NAME = process.env.VOICE_NAME ?? 'Puck'
const CARRIER = 'thunderbolt.v1'
const bearerSubprotocol = process.env.VOICE_BEARER_SUBPROTOCOL

const isNative = /native-audio/.test(MODEL) || /2\.5/.test(MODEL)
const SCHEMA_UPPER = process.env.SCHEMA_UPPER === '1'
const THINKING0 = process.env.THINKING0 === '1'
const RESUMPTION = process.env.RESUMPTION === '1'

if (!bearerSubprotocol) {
  console.error('Set VOICE_BEARER_SUBPROTOCOL (the thunderbolt.bearer.<encoded> entry from a live request).')
  process.exit(1)
}

console.log(
  `[cfg] model=${MODEL} native=${isNative} SCHEMA_UPPER=${SCHEMA_UPPER} THINKING0=${THINKING0} RESUMPTION=${RESUMPTION}`,
)

const t = (type: string): string => (SCHEMA_UPPER ? type.toUpperCase() : type)

/** submit_prompt tool — mirrors router.ts, with the schema-case + behavior knobs. */
const submitPromptTool = {
  name: 'submit_prompt',
  description: 'The finalized request to the model, synthesized from the discussion (not a verbatim transcript).',
  ...(isNative ? { behavior: 'NON_BLOCKING' } : {}),
  parameters: { type: t('object'), properties: { prompt: { type: t('string') } }, required: ['prompt'] },
}

const SYSTEM_PROMPT = [
  'Ты голосовой ко-пилот пользователя, работаешь в реальном времени по-русски.',
  'Обсуди голосом, чего хочет пользователь, задай короткие уточняющие вопросы.',
  'Когда намерение ясно — ВЫЗОВИ функцию submit_prompt с синтезированным финальным запросом',
  '(чёткая самодостаточная задача для ассистента, НЕ дословная расшифровка).',
  'После submit_prompt озвучь пользователю, что задача передана.',
  'Говори чистым русским, без латиницы.',
].join(' ')

const getWsUrl = (cloudUrl: string, model: string): string => {
  const base = cloudUrl.replace(/^http/, 'ws').replace(/\/v1\/?$/, '')
  return `${base}/v1/gemini-live?model=${encodeURIComponent(model)}`
}

const url = getWsUrl(CLOUD_URL, MODEL)
console.log('[test] connecting', url)

const socket = new WebSocket(url, [CARRIER, bearerSubprotocol])
socket.binaryType = 'arraybuffer'

let ready = false
let toolCalls = 0
let audioFrames = 0
let outTranscript = ''
let lastToolArgs = ''
let step = 0
let finished = false

const send = (obj: unknown) => socket.send(JSON.stringify(obj))

const finish = () => {
  if (finished) return
  finished = true
  console.log(
    `[test] RESULT ready=${ready} toolCalls=${toolCalls} lastPrompt=${JSON.stringify(lastToolArgs.slice(0, 200))} audioFrames=${audioFrames} transcript=${JSON.stringify(outTranscript.slice(0, 200))}`,
  )
  process.exit(0)
}

const handleMessage = (raw: string) => {
  let m: {
    setupComplete?: unknown
    sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean }
    serverContent?: {
      modelTurn?: { parts?: Array<{ inlineData?: { data?: string }; text?: string }> }
      outputTranscription?: { text?: string }
      turnComplete?: boolean
    }
    toolCall?: { functionCalls?: Array<{ id: string; name: string; args?: Record<string, unknown> }> }
  }
  try {
    m = JSON.parse(raw)
  } catch {
    return
  }

  if (m.setupComplete) {
    ready = true
    console.log('[test] setupComplete → step 1: ask to delegate a task')
    step = 1
    send({
      realtimeInput: {
        text: 'Поставь агенту задачу: найди топ-5 кофеен в центре Москвы с рейтингом выше 4.5 и сведи их в таблицу. Сформулируй запрос и передай его через submit_prompt.',
      },
    })
    setTimeout(() => {
      if (toolCalls === 0) {
        console.log('[test] no tool call after step 1 — nudging')
        send({ realtimeInput: { text: 'Просто вызови submit_prompt с этой задачей сейчас.' } })
      }
    }, 6000)
    return
  }

  if (m.sessionResumptionUpdate) {
    console.log('[test] sessionResumptionUpdate resumable=', m.sessionResumptionUpdate.resumable)
  }

  for (const call of m.toolCall?.functionCalls ?? []) {
    toolCalls++
    lastToolArgs = JSON.stringify(call.args ?? {})
    console.log(`[test] >>> TOOL CALL #${toolCalls}: ${call.name} args=${lastToolArgs.slice(0, 200)}`)
    // Respond (WHEN_IDLE for native-audio non-blocking tools).
    const fnResponse = isNative
      ? { id: call.id, name: call.name, response: { status: 'ok' }, scheduling: 'WHEN_IDLE' }
      : { id: call.id, name: call.name, response: { status: 'ok' } }
    send({ toolResponse: { functionResponses: [fnResponse] } })
    // Context-continuity probe: reference the first task without restating it.
    if (step === 1) {
      step = 2
      setTimeout(() => {
        // BIG_RESULT=1 simulates relayAgentResult flooding native-audio's context
        // with the full agent reply (e.g. a long table) before the next turn.
        if (process.env.BIG_RESULT === '1') {
          const bigRows = Array.from({ length: 120 }, (_, i) => `${i + 1}. Кофейня №${i + 1} — рейтинг 4.${(i % 5) + 5}, адрес: ул. Примерная, д. ${i + 1}, есть веранда, часы 8:00–22:00, средний чек 350р.`).join('\n')
          console.log(`[test] injecting BIG agent result (${bigRows.length} chars) via sendText`)
          send({ realtimeInput: { text: `Результат работы агента:\n${bigRows}` } })
        }
        console.log('[test] step 2: follow-up referencing the FIRST task (context probe)')
        send({
          realtimeInput: {
            text: 'Добавь к той же задаче ещё одно требование: только кофейни с верандой. Обнови и передай снова.',
          },
        })
        setTimeout(finish, 8000)
      }, 3000)
    }
  }

  if (m.serverContent) {
    for (const part of m.serverContent.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) audioFrames++
    }
    if (m.serverContent.outputTranscription?.text) outTranscript += m.serverContent.outputTranscription.text
  }
}

socket.onopen = () => {
  console.log('[test] socket open → sending setup')
  send({
    setup: {
      model: `models/${MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        temperature: 0.8,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
          ...(isNative ? {} : { languageCode: 'ru-RU' }),
        },
        ...(THINKING0 && isNative ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      tools: [{ functionDeclarations: [submitPromptTool] }],
      realtimeInputConfig: {
        automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', prefixPaddingMs: 300 },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(RESUMPTION ? { sessionResumption: {} } : {}),
    },
  })
}

socket.onmessage = (event: MessageEvent) => {
  const data = event.data
  handleMessage(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer))
}

socket.onerror = (event) => console.log('[test] socket error', (event as { message?: string })?.message ?? '')
socket.onclose = (event) => {
  console.log(`[test] socket close ${event.code} ${event.reason}`)
  finish()
}

setTimeout(() => {
  console.log('[test] overall timeout')
  finish()
}, 30000)
