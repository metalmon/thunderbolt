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
import { getLocalSetting } from '@/stores/local-settings-store'
import { isVoiceCoPilotEnabled } from '@/voice/voice-mode'
import { createGeminiLiveEngine, type ToolDeclaration } from './gemini-live-engine'
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

/**
 * @param systemInstruction The fully assembled Gemini Live system instruction
 *   (per-language base + persona + chat context — see
 *   `voice/gemini/prompts.ts`'s `buildSystemInstruction`, Task 11), built by
 *   the caller and threaded straight into the realtime engine's setup frame.
 */
export const createVoiceEngine = (customProviderEnabled: boolean, systemInstruction = ''): VoiceEngineResult => {
  const config = getLocalSetting('voiceProvider')

  // Realtime engine: Gemini Live (gated behind custom provider flag).
  if (isVoiceCoPilotEnabled(customProviderEnabled)) {
    // TODO(THU voice task 12): read model/voiceName from `config` (currently
    // hardcoded) — systemInstruction is already threaded in from the caller
    // (Task 11).
    return {
      kind: 'realtime',
      engine: createGeminiLiveEngine({
        model: 'gemini-live-2.5-flash-preview',
        voiceName: 'Kore',
        systemInstruction,
        tools: [submitPromptTool],
      }),
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
