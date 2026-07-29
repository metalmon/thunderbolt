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
import { createGeminiLiveEngine } from './gemini-live-engine'
import { createOpenAiCompatibleEngine } from './openai-compatible-engine'
import type { RealtimeEngine } from './realtime-types'
import { createThunderboltEngine } from './thunderbolt-engine'
import type { VoiceEngine } from './types'

export type VoiceEngineResult =
  | { kind: 'pipeline'; engine: VoiceEngine }
  | { kind: 'realtime'; engine: RealtimeEngine }

export const createVoiceEngine = (customProviderEnabled: boolean): VoiceEngineResult => {
  const config = getLocalSetting('voiceProvider')

  // Realtime engine: Gemini Live (gated behind custom provider flag).
  if (customProviderEnabled && config.kind === 'gemini-live') {
    return { kind: 'realtime', engine: createGeminiLiveEngine() }
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
