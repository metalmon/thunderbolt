/**
 * The managed lane: the deployment's own model, with the key held on the server.
 *
 * A perimeter deployment serves one model of its own and must never hand the
 * key to a client, so the client talks to our backend and the backend attaches
 * the key (`backend/src/fork/openrouter/routes.ts`). The lane fronts an
 * arbitrary OpenAI-compatible gateway — llama.cpp on the same machine, just as
 * readily as a cloud vendor.
 *
 * **Why a provider of our own.** The lane was first built on upstream's
 * `openrouter` provider with `isSystem: 1` as the switch, and that one decision
 * is what put the word «OpenRouter» under a model that has never been
 * anywhere near openrouter.ai — in the picker, in the badge, and in every file a reader
 * opened to find out what the lane was. Upstream's `openrouter` is a real
 * feature of its own (a user's own key, going to openrouter.ai), so it cannot
 * be renamed; the fork's lane simply needed its own name instead of borrowing
 * one. `managed` matches the backend path it talks to.
 *
 * The old shape still works and must: a client installed before this change
 * carries `openrouter` rows with `isSystem: 1`, and its requests go to the
 * `/openrouter` alias. Hence the `path` argument — one lane, two addresses,
 * until those installs are gone.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

import { getAuthToken } from '@/lib/auth-token'
import { getLocalSetting } from '@/stores/local-settings-store'
import { isSsoMode } from '@/lib/auth-mode'
import { omitDefaultToolChoice } from '@/fork/ai/omit-default-tool-choice'

/** The backend paths the lane answers on. `openrouter` is the legacy alias. */
export type ManagedLanePath = 'managed' | 'openrouter'

/**
 * Absolute base URL for the lane.
 *
 * On the web demo `cloudUrl` is same-origin-relative (e.g. `/v1`); the AI SDK
 * builds request URLs with `new URL()`, which rejects a relative base ("Failed
 * to construct 'URL'"). Desktop's `cloudUrl` is already absolute and passes
 * through untouched.
 */
export const managedLaneBaseUrl = (rawCloudUrl: string, path: ManagedLanePath, origin: string): string => {
  const cloudUrl = URL.canParse(rawCloudUrl) ? rawCloudUrl : new URL(rawCloudUrl, origin).toString().replace(/\/$/, '')
  return `${cloudUrl}/${path}`
}

/**
 * Carry the session to our own backend and nowhere else.
 *
 * SSO web sends cookies; token auth sends the bearer. Both are for the hop to
 * the backend — the key for the upstream gateway is attached on its side.
 */
const laneFetch = (sso: boolean, token: string | null): typeof fetch =>
  Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const upstreamInit: RequestInit = { ...init, headers }
      if (sso && !token) {
        upstreamInit.credentials = 'include'
        headers.delete('authorization')
      } else if (token) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      return fetch(input, upstreamInit)
    },
    { preconnect: fetch.preconnect },
  )

/** The language model for a managed-lane row. */
export const createManagedLaneModel = (model: string, path: ManagedLanePath = 'managed') => {
  const lane = createOpenAICompatible({
    name: 'volt-managed',
    baseURL: managedLaneBaseUrl(getLocalSetting('cloudUrl'), path, window.location.origin),
    // The SDK insists on a key; the real one never leaves the server.
    apiKey: 'volt-managed',
    fetch: laneFetch(isSsoMode(), getAuthToken()),
    // The lane fronts an arbitrary deployment gateway, and not every one of
    // them digests `tool_choice`. Dropping `auto` is a no-op per the spec.
    transformRequestBody: omitDefaultToolChoice,
  })
  return lane(model)
}
