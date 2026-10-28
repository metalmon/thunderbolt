/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ExternalLinkBehavior } from '@/lib/external-link-behavior'
import { isRecord } from '@shared/lib/is-record'
import { localSettingsStorageName, migrateLocalSettingsKey } from '@/fork/storage/local-settings-key'

/**
 * Voice engine selection (THU-718). `thunderbolt` uses the hosted enclave STT/TTS
 * (via the /tinfoil proxy); `openai-compatible` points at any OpenAI-shaped
 * `/v1/audio/*` endpoint — another provider or a self-hosted local server.
 * Device-local (not synced): holds a key and a machine-specific URL.
 */
/** The two Gemini Live model families (THU-718 voice co-pilot): `half-cascade`
 *  transcribes/synthesizes via a cascaded STT→LLM→TTS pipeline; `native-audio`
 *  generates speech end-to-end for lower latency and more expressive tone.
 *  Each supports its own prebuilt voice catalog — see `geminiVoices`. */
export type GeminiLiveModel = 'native-audio' | 'half-cascade'

export type VoiceProviderConfig = {
  kind: 'thunderbolt' | 'openai-compatible' | 'gemini-live'
  /** Base URL including the version prefix, e.g. http://localhost:8000/v1. */
  baseUrl: string
  apiKey: string
  /** BYOK Gemini Live key; device-local, never synced. Empty ⇒ fall back to
   *  the server key if the operator set one. */
  geminiApiKey: string
  sttModel: string
  ttsModel: string
  ttsVoice: string
  /** Gemini Live model family. */
  model: GeminiLiveModel
  /** Gemini Live prebuilt voice name (must be a member of `geminiVoices[model]`). */
  voiceName: string
  /** Free-text system-instruction fragment appended to shape the assistant's
   *  tone/style during Gemini Live voice conversations. Empty means none. */
  personalityPrompt: string
}

export const defaultVoiceProvider: VoiceProviderConfig = {
  // Fork: the `thunderbolt` lane reaches `/v1/audio/*` through our backend, so an
  // autonomous install cannot use it — and leaving it as the default would mean
  // voice reads as configured while silently never working. `openai-compatible`
  // with an empty `baseUrl` is inert until the user names their own endpoint,
  // which is the honest starting state for a build that has no backend.
  kind: import.meta.env.VITE_THUNDERBOLT_CLOUD_URL ? 'thunderbolt' : 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  geminiApiKey: '',
  sttModel: 'whisper-large-v3-turbo',
  ttsModel: 'qwen3-tts',
  ttsVoice: 'aiden',
  model: 'half-cascade',
  voiceName: 'Kore',
  personalityPrompt: '',
}

/** Fork: whether this installation talks to a backend at all. See `@/fork/local-mode/mode`. */
export type OperationMode = 'server' | 'local'

type LocalSettingsState = {
  cloudUrl: string
  /** Fork: `'local'` means no account, no sync and no backend-bound features.
   *  Defaults from the build — a build with no backend address configured is an
   *  autonomous one — and is then the user's own persisted choice. */
  operationMode: OperationMode
  externalLinkBehavior: ExternalLinkBehavior
  debugPosthog: boolean
  isNativeFetchEnabled: boolean
  hapticsEnabled: boolean
  syncEnabled: boolean
  /** A recovery phrase was minted but the user has not confirmed saving it.
   *  Survives reload/crash so the app can re-prompt — the phrase itself is
   *  unrecoverable (AK = PBKDF2(seed, salt)), so the prompt offers a rotation. */
  recoveryPhrasePending: boolean
  /** Null until the user picks one; ThemeProvider then falls back to the operator default, then 'system'.
   *  Fork: 'paper' is a fixed warm palette the user can choose like any other theme. */
  theme: 'light' | 'dark' | 'system' | 'paper' | null
  voiceProvider: VoiceProviderConfig
}

type LocalSettingsActions = {
  setLocalSetting: <K extends keyof LocalSettingsState>(key: K, value: LocalSettingsState[K]) => void
}

type LocalSettingsStore = LocalSettingsState & LocalSettingsActions

export const initialLocalSettings: LocalSettingsState = {
  cloudUrl: import.meta.env.VITE_THUNDERBOLT_CLOUD_URL || 'http://localhost:8000/v1',
  // An unset (or empty) backend address is the signal: nothing to talk to, so
  // start autonomous. It cannot be inferred from `cloudUrl` above, whose
  // fallback is a real-looking localhost URL.
  operationMode: import.meta.env.VITE_THUNDERBOLT_CLOUD_URL ? 'server' : 'local',
  externalLinkBehavior: 'ask',
  debugPosthog: false,
  isNativeFetchEnabled: true,
  hapticsEnabled: true,
  syncEnabled: false,
  recoveryPhrasePending: false,
  theme: null,
  voiceProvider: defaultVoiceProvider,
}

/**
 * Upgrade persisted local settings to the current version. Version 1 made
 * `theme` null until the user picks one, so the operator's branding default
 * can apply; before it, 'system' was the default every install stored, not a
 * choice, so it is read as unset. index.html's pre-paint script mirrors this.
 *
 * @param persisted - The stored state, as zustand hands it over.
 * @param version - The version it was stored under.
 */
export const migrateLocalSettings = (persisted: unknown, version: number): Record<string, unknown> => {
  const state = isRecord(persisted) ? persisted : {}
  return version < 1 && state.theme === 'system' ? { ...state, theme: null } : state
}

// Ahead of `persist`'s first read, so an upgrade keeps the settings it finds under the
// old key instead of starting from defaults.
migrateLocalSettingsKey()

export const useLocalSettingsStore = create<LocalSettingsStore>()(
  persist(
    (set) => ({
      ...initialLocalSettings,
      setLocalSetting: (key, value) => set({ [key]: value }),
    }),
    {
      name: localSettingsStorageName,
      // See migrateLocalSettings; index.html reads this version too.
      version: 1,
      // zustand types this as the whole store, but merges it over the initial
      // state, so stored data missing a key keeps that key's default.
      migrate: (persisted, version) => migrateLocalSettings(persisted, version) as LocalSettingsStore,
      // Deep-merge persisted state over defaults so nested fields added in a
      // newer build (e.g. voiceProvider.model/voiceName/personalityPrompt) fall
      // back to their defaults for users upgrading from an older persisted
      // config. Zustand's default merge is shallow, so a stored voiceProvider
      // from before those fields existed would leave them undefined and crash
      // the Gemini Live settings (geminiVoices[undefined].map / personality.trim()).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LocalSettingsState>
        return {
          ...current,
          ...p,
          voiceProvider: { ...current.voiceProvider, ...(p.voiceProvider ?? {}) },
        }
      },
      // Listed explicitly (rather than spread + omit) so TS errors if a new
      // LocalSettingsState field is added without persisting it, and so no
      // future store action can silently leak into localStorage.
      partialize: (s): LocalSettingsState => ({
        cloudUrl: s.cloudUrl,
        operationMode: s.operationMode,
        externalLinkBehavior: s.externalLinkBehavior,
        debugPosthog: s.debugPosthog,
        isNativeFetchEnabled: s.isNativeFetchEnabled,
        hapticsEnabled: s.hapticsEnabled,
        syncEnabled: s.syncEnabled,
        recoveryPhrasePending: s.recoveryPhrasePending,
        theme: s.theme,
        voiceProvider: s.voiceProvider,
      }),
    },
  ),
)

/**
 * Type-safe synchronous read for non-React consumers.
 * Return type narrows per key (e.g. `getLocalSetting('cloudUrl')` → `string`).
 */
export const getLocalSetting = <K extends keyof LocalSettingsState>(key: K): LocalSettingsState[K] =>
  useLocalSettingsStore.getState()[key]
