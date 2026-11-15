/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * React lifecycle wrapper around the voice session (THU-689). Builds the session
 * from the current chat's `Chat` instance so a voice turn is a real chat turn,
 * and exposes the state/transcripts the overlay renders.
 */
import { selectBuiltInAgentEnabled, useConfigStore } from '@/api/config-store'
import { useChatStore, useCurrentChatSession } from '@/chats/chat-store'
import { isPrivateAutoRunBlocked } from '@/chats/private-thread'
import { useDatabase } from '@/contexts'
import { builtInAgent } from '@/defaults/agents'
import { getSettings } from '@/dal'
import { isDirectVoiceKeyMissing } from '@/fork/voice/direct-voice-gate'
import { isVoiceEngineUnavailable } from '@/fork/voice/engine-unavailable'
import { getActiveLocale } from '@/i18n/active-locale'
import { computeEffectiveProxyEnabled } from '@/lib/proxy-fetch'
import { showSignInModalEvent } from '@/hooks/use-credential-events'
import { hasServerAuthentication } from '@/lib/provider-mode'
import { getLocalSetting } from '@/stores/local-settings-store'
import type { ThunderboltUIMessage } from '@/types'
import type { ReplyChat } from '@/voice/chat-reply'
import type { ContextMessage, VoiceLang } from '@/voice/gemini/prompts'
import type { SessionState } from '@/voice/session'
import { toVoiceErrorMessage } from '@/voice/voice-error'
import { createSessionLifecycle } from './session-lifecycle'
import { isVoiceCoPilotEnabled, setVoiceModeActive } from '@/voice/voice-mode'
import type { Chat } from '@ai-sdk/react'
import { i18n, type MessageDescriptor } from '@lingui/core'
import { msg } from '@lingui/core/macro'
import { useEffect, useMemo, useReducer, useRef } from 'react'

/** Fork: what an install with no speech server is told, instead of a raw engine failure. */
const voiceEngineMissingMessage = msg`Voice needs your own speech server. Add its address in Settings → Voice.`

/** Thrown by a voice send the private auto-run hold refuses; `toVoiceOverlayError` translates it. */
class PrivateChatHeldError extends Error {
  readonly agentName: string

  constructor(agentName: string) {
    super(`This private chat won't run on ${agentName}`)
    this.name = 'PrivateChatHeldError'
    this.agentName = agentName
  }
}

// The composer notice's copy, so the overlay and the notice read alike in every locale.
const privateChatHeldMessage = (agentName: string, builtInAgentName: string | null): MessageDescriptor =>
  builtInAgentName
    ? msg`This private chat won't run on ${agentName}. Switch to ${builtInAgentName} to run it.`
    : msg`This private chat won't run on ${agentName}.`

/** The overlay's line for any error that is not a held private chat. Fork: upstream
 *  renders the thrown error, which for the pipeline engine is a raw English string
 *  straight from the backend; the cause is already on the console next to it. */
const voiceServiceErrorMessage = msg`Voice service error. Try again, or switch the provider in Settings → Voice.`

/** Fork: the direct (BYOK) lane has no key on this device. */
const geminiKeyMissingMessage = msg`Add your Gemini API key in Settings → Voice to use voice on this device.`

/**
 * The line the voice overlay shows for a session error. A held private chat gets
 * the composer notice's translated copy, resolved now because the overlay stores
 * a string; anything else gets the generic localized line.
 */
export const toVoiceOverlayError = (error: unknown): string => {
  if (!(error instanceof PrivateChatHeldError)) {
    return i18n._(voiceServiceErrorMessage)
  }
  const builtInAgentName = selectBuiltInAgentEnabled(useConfigStore.getState().config) ? builtInAgent.name : null
  return i18n._(privateChatHeldMessage(error.agentName, builtInAgentName))
}

/** Most recent chat messages to carry into the voice system instruction as
 *  conversational context (see `buildSystemInstruction`'s `contextMessages`).
 *  Bounded so a long-running chat doesn't grow the prompt unboundedly — the
 *  tail of the conversation is what's relevant to a voice turn continuing it. */
const maxContextMessages = 12

/** Render the chat's own message history into the plain `{role,text}` shape
 *  `buildSystemInstruction` expects, keeping only the most recent messages and
 *  dropping any with no renderable text (e.g. a tool-only turn). */
const toContextMessages = (messages: readonly ThunderboltUIMessage[]): ContextMessage[] =>
  messages
    .slice(-maxContextMessages)
    .map((message) => ({
      role: message.role,
      text: message.parts.reduce((text, part) => (part.type === 'text' ? text + (part.text ?? '') : text), ''),
    }))
    .filter((message) => message.text.length > 0)

/**
 * The UI language for the voice system instruction, read from the app's own
 * active locale — not `navigator.language`, which it used while the app had no
 * language of its own. The two disagree for exactly the user who set the app to
 * Russian in a browser that asks for English, and that user wants Russian voice.
 *
 * Read at session start rather than subscribed: the instruction is baked into the
 * engine at construction, so a language change applies to the next session.
 */
const resolveVoiceLang = (): VoiceLang => (getActiveLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en')

/** BCP-47 speech language for the half-cascade `speechConfig.languageCode`
 *  (accent fix), derived from the same `VoiceLang` the system instruction uses
 *  so the model is told to speak, and pronounce, one consistent language. */
const voiceLangToBcp47: Record<VoiceLang, string> = { ru: 'ru-RU', en: 'en-US' }

/**
 * Adapt the AI SDK `Chat` to the structural `ReplyChat` slice the voice session
 * needs. `Chat` provides `sendMessage`/`messages`/`stop`, but its broader method
 * signatures mean TS won't infer the match — an explicit adapter keeps chat-reply
 * decoupled from the SDK and avoids an `as unknown as` cast at the call site.
 *
 * Each send re-checks the private auto-run hold against the live session, so a
 * voice session already running when the hold applies cannot carry a private
 * chat to a non-built-in agent either. The rejection lands in the session's
 * error state.
 */
export const toReplyChat = (chat: Chat<ThunderboltUIMessage>, chatThreadId: string): ReplyChat => ({
  sendMessage: async (message) => {
    const session = useChatStore.getState().sessions.get(chatThreadId)
    if (
      session &&
      isPrivateAutoRunBlocked({
        chatThread: session.chatThread,
        agent: session.selectedAgent,
        status: chat.status,
        stopping: session.stopping,
        lastRole: chat.messages.at(-1)?.role,
      })
    ) {
      throw new PrivateChatHeldError(session.selectedAgent.name)
    }
    await chat.sendMessage(message)
  },
  get messages() {
    return chat.messages
  },
  stop: () => chat.stop(),
})

type VoiceUiState =
  | { phase: 'closed' | 'starting' }
  | { phase: 'running'; state: SessionState; error: string | null }
  | { phase: 'failed'; error: string }

type VoiceUiAction =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'STATE'; state: SessionState }
  | { type: 'ERROR' | 'START_FAILED'; error: string }

/** UI transitions follow the currently owned voice attempt only. */
export const voiceUiReducer = (state: VoiceUiState, action: VoiceUiAction): VoiceUiState => {
  switch (action.type) {
    case 'START':
      return { phase: 'starting' }
    case 'STOP':
      return { phase: 'closed' }
    case 'STATE':
      if (state.phase === 'closed' || state.phase === 'failed') {
        return state
      }
      return { phase: 'running', state: action.state, error: state.phase === 'running' ? state.error : null }
    case 'START_FAILED':
      return { phase: 'failed', error: action.error }
    case 'ERROR':
      if (state.phase === 'closed') {
        return state
      }
      return state.phase === 'running' ? { ...state, error: action.error } : { phase: 'failed', error: action.error }
  }
}

export const useVoiceSession = () => {
  const session = useCurrentChatSession()
  const db = useDatabase()
  const [ui, dispatch] = useReducer(voiceUiReducer, { phase: 'closed' })
  // Live mic level, updated ~30×/s. A ref (not state) so the waveform can read it
  // in a rAF loop without re-rendering the composer on every frame.
  const levelRef = useRef(0)
  const lifecycle = useMemo(
    () =>
      createSessionLifecycle({
        onStarting: () => dispatch({ type: 'START' }),
        onStopped: () => {
          levelRef.current = 0
          dispatch({ type: 'STOP' })
        },
        onState: (state) => dispatch({ type: 'STATE', state }),
        onError: (error, terminal) => {
          console.error('[voice]', error)
          // Fork: an autonomous install has no hosted voice lane, so this is not a
          // failure to report but a setting to fill in — said in the user's language,
          // unlike its untranslated siblings in `voice-error.ts`.
          const message = isVoiceEngineUnavailable(error)
            ? i18n._(voiceEngineMissingMessage)
            : error instanceof PrivateChatHeldError
              ? toVoiceOverlayError(error)
              : toVoiceErrorMessage(error)
          dispatch({ type: terminal ? 'START_FAILED' : 'ERROR', error: message })
        },
        onLevel: (level) => {
          levelRef.current = level
        },
        onActiveChange: setVoiceModeActive,
      }),
    [],
  )
  const outputLevelRef = useMemo(
    () => ({
      get current() {
        return lifecycle.getOutputLevel()
      },
    }),
    [lifecycle],
  )

  useEffect(
    () => () => {
      void lifecycle.stop()
    },
    [lifecycle],
  )

  const start = () =>
    lifecycle.start(async (callbacks, signal) => {
      // Lazy-load the voice runtime (session + engines + VAD/playback/aggregator
      // graph) only when the user actually starts voice — it's a non-critical
      // feature and must stay out of the always-mounted chat composer's entry
      // bundle. Read the flag authoritatively from the DB here too (not via a
      // reactive hook that returns `false` until its query resolves) so a custom
      // provider is never bypassed for the hardwired engine on a cold start.
      const [
        { createVoiceSession },
        { createRealtimeSession },
        { createVoiceEngine },
        { createChatReply },
        { buildSystemInstruction },
        { experimentalFeatureVoice },
      ] = await Promise.all([
        import('@/voice/session'),
        import('@/voice/realtime-session'),
        import('@/voice/engine/router'),
        import('@/voice/chat-reply'),
        import('@/voice/gemini/prompts'),
        getSettings(db, { experimental_feature_voice: false }),
      ])
      signal.throwIfAborted()

      // Direct path (co-pilot on, proxy off) mints its ephemeral token from the
      // user's own BYOK key — with none, the connection is doomed. Block here
      // with an actionable message instead of letting the engine throw deep
      // inside connect().
      if (
        isDirectVoiceKeyMissing({
          coPilotEnabled: isVoiceCoPilotEnabled(experimentalFeatureVoice),
          proxyEnabled: computeEffectiveProxyEnabled(),
          geminiApiKey: getLocalSetting('voiceProvider').geminiApiKey,
        })
      ) {
        // Reported through upstream's own terminal-failure action, the way the
        // lifecycle reports every other start failure; `return null` aborts the
        // start exactly as the sign-in gate below does.
        dispatch({
          type: 'START_FAILED',
          error: i18n._(geminiKeyMissingMessage),
        })
        return null
      }

      const voiceLang = resolveVoiceLang()
      // Per-language functional base + the user's persona + recent chat history,
      // assembled most-stable-first so a prefix-caching backend can reuse the
      // base+persona prefix across turns. Threaded into `createVoiceEngine`, which
      // bakes it into the Gemini Live setup frame — together with the model and voice
      // from device-local voice settings (see `engine/router.ts`, `resolveGeminiEngineOptions`).
      const systemInstruction = buildSystemInstruction({
        lang: voiceLang,
        personality: getLocalSetting('voiceProvider').personalityPrompt,
        contextMessages: toContextMessages(session.chatInstance.messages),
      })
      const engineResult = createVoiceEngine(experimentalFeatureVoice, systemInstruction, voiceLangToBcp47[voiceLang])
      if (engineResult.kind === 'realtime') {
        // Realtime (bidi) engine — the server handles STT/LLM/TTS over one WebSocket.
        // The system instruction is baked into `engineResult.engine` at construction
        // time (see `engine/router.ts`) rather than passed here.
        return createRealtimeSession({
          engine: engineResult.engine,
          chat: toReplyChat(session.chatInstance, session.id),
          hasChatHistory: session.chatInstance.messages.length > 0,
          lang: voiceLang,
          ...callbacks,
        })
      }
      const engine = engineResult.engine
      if (engine.id === 'thunderbolt' && (!getLocalSetting('cloudUrl') || !hasServerAuthentication())) {
        window.dispatchEvent(new CustomEvent(showSignInModalEvent))
        return null
      }
      return createVoiceSession({
        engine,
        reply: createChatReply(toReplyChat(session.chatInstance, session.id)),
        ...callbacks,
      })
    })

  return {
    active: ui.phase !== 'closed',
    state: ui.phase === 'running' ? ui.state : ('idle' as const),
    error: ui.phase === 'failed' || ui.phase === 'running' ? ui.error : null,
    start,
    stop: lifecycle.stop,
    levelRef,
    outputLevelRef,
  }
}
