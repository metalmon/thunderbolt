/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Voice engine selection (THU-700 / THU-718).
 *
 * The default is the Thunderbolt-hosted STT/TTS (Tinfoil-backed, enclave-private)
 * and it is hard-wired: pointing voice at a custom OpenAI-compatible endpoint is
 * gated behind the `experimental_feature_voice` flag (the same flag that reveals
 * the Voice settings page). When the flag is off we always use Thunderbolt, even
 * if a stale custom config lingers in device-local settings. Read at session
 * start, so a settings change applies on the next voice turn.
 */
import { type GeminiLiveModel, getLocalSetting, type VoiceProviderConfig } from '@/stores/local-settings-store'
import { isVoiceCoPilotEnabled } from '@/voice/voice-mode'
import {
  createGeminiLiveEngine,
  type CreateGeminiLiveEngineOptions,
  geminiVoices,
  type ToolDeclaration,
} from './gemini-live-engine'
import { createOpenAiCompatibleEngine } from './openai-compatible-engine'
import type { RealtimeEngine } from './realtime-types'
import { createThunderboltEngine } from './thunderbolt-engine'
import type { VoiceEngine } from './types'

export type VoiceEngineResult = { kind: 'pipeline'; engine: VoiceEngine } | { kind: 'realtime'; engine: RealtimeEngine }

/** Function declaration for the `submit_prompt` tool (Task 7): the model calls
 *  this once it has synthesized the user's request from the voice discussion,
 *  and `realtime-session.ts` hands the resulting prompt to the normal chat
 *  agent. */
const submitPromptTool: ToolDeclaration = {
  name: 'submit_prompt',
  description: 'The finalized request to the model, synthesized from the discussion (not a verbatim transcript).',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
    },
    required: ['prompt'],
  },
}

/** Map a settings Gemini Live model *family* to the concrete Gemini model id
 *  the engine/relay speaks. `native-audio` names select the v1alpha upstream
 *  endpoint (see `upstreamUrlFor` in the backend relay); `half-cascade` uses
 *  the standard live-preview model on v1beta. */
const geminiModelIds: Record<GeminiLiveModel, string> = {
  'half-cascade': 'gemini-3.1-flash-live-preview',
  'native-audio': 'gemini-2.5-flash-native-audio-preview-12-2025',
}

/**
 * Resolve the concrete Gemini Live engine options from device-local voice
 * settings. Exported for direct unit testing — the constructed `RealtimeEngine`
 * is otherwise opaque to what model/voice it was built with.
 *
 * A `voiceName` that isn't valid for the selected model family (e.g. a stale
 * value left over from switching models) falls back to that family's first
 * prebuilt voice rather than sending Gemini an invalid voice that would error
 * the session.
 */
export const resolveGeminiEngineOptions = (
  config: VoiceProviderConfig,
  systemInstruction: string,
): CreateGeminiLiveEngineOptions => {
  const voices = geminiVoices[config.model]
  return {
    model: geminiModelIds[config.model],
    voiceName: voices.includes(config.voiceName) ? config.voiceName : voices[0],
    systemInstruction,
    tools: [submitPromptTool],
  }
}

/**
 * @param systemInstruction The fully assembled Gemini Live system instruction
 *   (per-language base + persona + chat context — see
 *   `voice/gemini/prompts.ts`'s `buildSystemInstruction`, Task 11), built by
 *   the caller and threaded straight into the realtime engine's setup frame.
 */
export const createVoiceEngine = (customProviderEnabled: boolean, systemInstruction = ''): VoiceEngineResult => {
  const config = getLocalSetting('voiceProvider')

  // Realtime engine: Gemini Live (gated behind custom provider flag). Model,
  // voice, and system instruction all come from device-local voice settings.
  if (isVoiceCoPilotEnabled(customProviderEnabled)) {
    return {
      kind: 'realtime',
      engine: createGeminiLiveEngine(resolveGeminiEngineOptions(config, systemInstruction)),
    }
  }

  // Pipeline engines: OpenAI-compatible or Thunderbolt.
  if (customProviderEnabled && config.kind === 'openai-compatible' && config.baseUrl.trim().length > 0) {
    return { kind: 'pipeline', engine: createOpenAiCompatibleEngine(config) }
  }

  return { kind: 'pipeline', engine: createThunderboltEngine() }
}

/** Convenience: get just the pipeline engine (backward compat). */
export const createPipelineVoiceEngine = (customProviderEnabled: boolean): VoiceEngine => {
  const result = createVoiceEngine(customProviderEnabled)
  if (result.kind === 'realtime') {
    throw new Error('createPipelineVoiceEngine called for realtime engine — use createVoiceEngine instead')
  }
  return result.engine
}
