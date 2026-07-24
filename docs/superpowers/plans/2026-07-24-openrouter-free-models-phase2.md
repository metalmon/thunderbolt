# OpenRouter Free Models — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anonymous demo users chat with free OpenRouter models via a backend-held key, replacing the upstream default model catalog; add per-user throttling and multi-key rotation.

**Architecture:** Clone the Tinfoil managed-model pattern — a new fork Elysia route (`/v1/openrouter/*`) injects the server key, rotates across keys on 429, and throttles per user; system `openrouter` models in `src/ai/fetch.ts` route through it with a placeholder key + session token; the default catalog in `shared/defaults/models.ts` is replaced with four free OpenRouter models.

**Tech Stack:** Elysia (Bun), Better Auth macro, Vercel AI SDK `createOpenAICompatible`, `bun test`.

## Global Constraints

- **Fork license boundary:** NEW additive file `backend/src/fork/openrouter/routes.ts` (+ its test) carries the MPL header, like `backend/src/tinfoil/routes.ts`. Invasive edits limited to EXACTLY these upstream files: `backend/src/index.ts`, `src/ai/fetch.ts`, `shared/defaults/models.ts`, `shared/defaults/models.test.ts`, `src/defaults/model-profiles/index.ts`, `powersync-service/docker-compose.yml`, `dev-local/docker/README-web-demo.md`. New profile file(s) under `src/defaults/model-profiles/` are additive. Touch NOTHING else. Do NOT edit `backend/src/config/settings.ts` — the route reads `process.env` directly.
- **Branch mapping:** additive route → `fork/additive`; invasive seams + catalog data → `fork/hooks`. (Assembled onto `master` by `dev-local/rebuild-master.ps1`.) When implementing in one working tree, commit each file to its branch per the fork flow at integration time; the controller handles branch/commit/rebuild.
- **The four models (verbatim):** provider `openrouter`, `isSystem:1`, fresh ids:
  - `38e10634-2fbc-4323-b86d-3a5a6c0ca824` — Nemotron 3 Super 120B — `nvidia/nemotron-3-super-120b-a12b:free` — ctx 262144 — **default (first)**
  - `d30990db-4d18-4713-8b08-ca8cabd206bb` — Nemotron 3 Ultra 550B — `nvidia/nemotron-3-ultra-550b-a55b:free` — ctx 1000000
  - `8a86bbe0-42a2-444c-aacf-7a8448262bb4` — Gemma 4 31B — `google/gemma-4-31b-it:free` — ctx 262144
  - `b4db7251-0475-45bb-8dfa-05dbbaa961ca` — Nemotron Nano 9B — `nvidia/nemotron-nano-9b-v2:free` — ctx 128000
- **Env:** `OPENROUTER_API_KEYS` (comma-separated), `OPENROUTER_FREE_RPM` (default 10), `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`).
- **Commits:** via `/thunderpush` (never raw git). **Version bump rule:** any change to `defaultModels` requires bumping `defaultModelsVersion` and updating the colocated snapshot test (CLAUDE.md).
- **Windows:** `bun test` runs from repo root and `backend/`. Fork git config already `autocrlf=false, eol=lf`.

---

### Task 1: OpenRouter fork route — key injection, rotation, throttle

**Files:**
- Create: `backend/src/fork/openrouter/routes.ts`
- Test: `backend/src/fork/openrouter/routes.test.ts`

**Interfaces:**
- Produces: `createOpenrouterRoutes(options: CreateOpenrouterRoutesOptions)` returning an Elysia sub-app (`prefix:'/openrouter'`). `CreateOpenrouterRoutesOptions = { auth: Auth; fetchFn?: typeof fetch; rateLimit?: AnyElysia; apiKeys?: string[]; baseUrl?: string; freeRpm?: number; now?: () => number; referer?: string; title?: string }`. Task 3 consumes `createOpenrouterRoutes` in `backend/src/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/fork/openrouter/routes.test.ts`:

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ConsoleSpies } from '@/test-utils/console-spies'
import { setupConsoleSpy } from '@/test-utils/console-spies'
import { mockAuth, mockAuthUnauthenticated } from '@/test-utils/mock-auth'
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { createOpenrouterRoutes } from './routes'

const baseUrl = 'https://openrouter.ai/api/v1'

const ok = (body = 'ok') => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })
const status = (code: number) => new Response(String(code), { status: code })
const drain = async (res: Response) => {
  if (res.body) await res.arrayBuffer()
  return res
}

describe('createOpenrouterRoutes', () => {
  let mockFetch: ReturnType<typeof mock>
  let consoleSpies: ConsoleSpies

  beforeAll(() => {
    consoleSpies = setupConsoleSpy()
    mockFetch = mock(() => Promise.resolve(ok()))
  })
  afterAll(() => consoleSpies.restore())
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation(() => Promise.resolve(ok()))
    consoleSpies.error.mockClear()
  })

  const build = (o: {
    apiKeys?: string[]
    freeRpm?: number
    now?: () => number
    auth?: typeof mockAuth
  } = {}) =>
    new Elysia().use(
      createOpenrouterRoutes({
        auth: o.auth ?? mockAuth,
        fetchFn: mockFetch as unknown as typeof fetch,
        apiKeys: o.apiKeys ?? ['k1'],
        baseUrl,
        freeRpm: o.freeRpm ?? 1000,
        now: o.now,
      }),
    )

  const post = (app: Elysia) =>
    app.handle(
      new Request('http://localhost/openrouter/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'x', messages: [] }),
      }),
    )

  it('returns 503 when no keys are configured', async () => {
    const res = await post(build({ apiKeys: [] }))
    expect(res.status).toBe(503)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await drain(await post(build({ auth: mockAuthUnauthenticated })))
    expect(res.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 405 for disallowed methods', async () => {
    const app = build()
    const res = await app.handle(new Request('http://localhost/openrouter/x', { method: 'DELETE', body: '' }))
    expect(res.status).toBe(405)
  })

  it('injects the server key and strips inbound Authorization', async () => {
    await drain(
      await build().handle(
        new Request('http://localhost/openrouter/chat/completions', {
          method: 'POST',
          headers: { Authorization: 'Bearer client-secret', 'content-type': 'application/json' },
          body: '{}',
        }),
      ),
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${baseUrl}/chat/completions`)
    expect((init.headers as Headers).get('authorization')).toBe('Bearer k1')
  })

  it('rotates to the next key when one returns 429', async () => {
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const auth = (init.headers as Headers).get('authorization')
      return Promise.resolve(auth === 'Bearer k1' ? status(429) : ok('from-k2'))
    })
    const res = await drain(await post(build({ apiKeys: ['k1', 'k2'], now: () => 1000 })))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('from-k2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns 429 when every key is rate-limited', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(status(429)))
    const res = await drain(await post(build({ apiKeys: ['k1', 'k2'], now: () => 1000 })))
    expect(res.status).toBe(429)
  })

  it('throttles per user beyond freeRpm', async () => {
    const app = build({ freeRpm: 1, now: () => 5000 })
    const first = await drain(await post(app))
    const second = await drain(await post(app))
    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    expect(second.headers.get('retry-after')).toBe('60')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test src/fork/openrouter/routes.test.ts`
Expected: FAIL — `Cannot find module './routes'` / `createOpenrouterRoutes is not a function`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/fork/openrouter/routes.ts`:

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Auth } from '@/auth/elysia-plugin'
import { createAuthMacro } from '@/auth/elysia-plugin'
import { safeErrorHandler } from '@/middleware/error-handling'
import { Elysia, type AnyElysia } from 'elysia'

const allowedMethods = new Set(['GET', 'POST', 'OPTIONS'])
const bodylessMethods = new Set(['GET', 'OPTIONS'])
const failoverStatuses = new Set([401, 402, 429])
const COOLDOWN_MS = 60_000
const REFILL_WINDOW_MS = 60_000

const textResponse = (status: number, body: string, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...headers } })

const parseKeys = (raw: string | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export type CreateOpenrouterRoutesOptions = {
  auth: Auth
  fetchFn?: typeof fetch
  rateLimit?: AnyElysia
  /** Override the key pool. Defaults to `OPENROUTER_API_KEYS` (comma-separated). */
  apiKeys?: string[]
  /** Override the upstream base URL. Defaults to `OPENROUTER_BASE_URL` or openrouter.ai. */
  baseUrl?: string
  /** Per-user requests/minute. Defaults to `OPENROUTER_FREE_RPM` or 10. */
  freeRpm?: number
  /** Injectable clock for deterministic tests. */
  now?: () => number
  /** Optional OpenRouter attribution headers. */
  referer?: string
  title?: string
}

/**
 * Free-tier OpenRouter proxy: injects a server-side key (rotating across a pool
 * on rate-limit), throttles per authenticated user, and streams the response.
 * System `openrouter` models point their baseURL at `${cloudUrl}/openrouter`.
 */
export const createOpenrouterRoutes = (options: CreateOpenrouterRoutesOptions) => {
  const { auth, rateLimit } = options
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const now = options.now ?? Date.now
  const keys = options.apiKeys ?? parseKeys(process.env.OPENROUTER_API_KEYS)
  const baseUrl = (options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(
    /\/$/,
    '',
  )
  const freeRpm = options.freeRpm ?? Number(process.env.OPENROUTER_FREE_RPM ?? '10')
  const referer = options.referer ?? process.env.OPENROUTER_REFERER
  const title = options.title ?? process.env.OPENROUTER_TITLE ?? 'Thunderbolt'

  // In-memory state (single backend instance — see spec limitations).
  const cooldownUntil = new Map<string, number>()
  const buckets = new Map<string, { tokens: number; last: number }>()
  let roundRobin = 0

  const availableKeys = (): string[] => {
    const t = now()
    return keys.filter((k) => (cooldownUntil.get(k) ?? 0) <= t)
  }

  const rotate = (arr: string[]): string[] => {
    if (arr.length === 0) return arr
    const start = roundRobin++ % arr.length
    return arr.map((_, i) => arr[(start + i) % arr.length])
  }

  const takeToken = (userId: string): boolean => {
    const cap = Math.max(1, freeRpm)
    const perMs = cap / REFILL_WINDOW_MS
    const t = now()
    const b = buckets.get(userId) ?? { tokens: cap, last: t }
    b.tokens = Math.min(cap, b.tokens + (t - b.last) * perMs)
    b.last = t
    if (b.tokens < 1) {
      buckets.set(userId, b)
      return false
    }
    b.tokens -= 1
    buckets.set(userId, b)
    return true
  }

  const buildHeaders = (request: Request): Headers => {
    const headers = new Headers()
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower === 'authorization' || lower === 'host' || lower === 'cookie' || lower === 'connection') return
      headers.set(key, value)
    })
    if (referer) headers.set('HTTP-Referer', referer)
    if (title) headers.set('X-Title', title)
    return headers
  }

  const streamBack = (upstream: Response): Response => {
    const responseHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (lower === 'transfer-encoding' || lower === 'connection') return
      responseHeaders.set(key, value)
    })
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  }

  const proxy = async (request: Request, wildcard: string, userId: string): Promise<Response> => {
    const method = request.method.toUpperCase()
    if (!allowedMethods.has(method)) return textResponse(405, 'Method not allowed')
    if (keys.length === 0) return textResponse(503, 'OpenRouter provider not configured')
    if (!takeToken(userId)) return textResponse(429, 'Rate limit exceeded', { 'Retry-After': '60' })

    const avail = availableKeys()
    if (avail.length === 0) return textResponse(429, 'All keys rate-limited', { 'Retry-After': '60' })

    const subpath = wildcard.startsWith('/') ? wildcard : `/${wildcard}`
    const search = new URL(request.url).search
    const upstreamUrl = `${baseUrl}${subpath}${search}`
    // Buffer the body so it can be re-sent to the next key on failover
    // (request streams are one-shot). Chat bodies are small.
    const body = bodylessMethods.has(method) ? null : await request.arrayBuffer()
    const headers = buildHeaders(request)

    let lastFailover: Response | null = null
    for (const key of rotate(avail)) {
      headers.set('Authorization', `Bearer ${key}`)
      const upstream = await fetchFn(upstreamUrl, {
        method,
        headers,
        body,
        redirect: 'manual',
        decompress: false,
      } as RequestInit & { decompress: boolean })

      if (failoverStatuses.has(upstream.status)) {
        cooldownUntil.set(key, now() + COOLDOWN_MS)
        await upstream.body?.cancel()
        lastFailover = upstream
        continue
      }
      return streamBack(upstream)
    }
    return textResponse(lastFailover?.status ?? 429, 'All keys rate-limited', { 'Retry-After': '60' })
  }

  return new Elysia({ prefix: '/openrouter' })
    .onError(safeErrorHandler)
    .use(createAuthMacro(auth))
    .guard({ auth: true }, (g) => {
      const handler = (ctx: { request: Request; params: Record<string, string | undefined>; user: { id: string } }) =>
        proxy(ctx.request, ctx.params['*'] ?? '', ctx.user.id)
      if (rateLimit) {
        return g.use(rateLimit).all('/*', handler, { parse: 'none' })
      }
      return g.all('/*', handler, { parse: 'none' })
    })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && bun test src/fork/openrouter/routes.test.ts`
Expected: PASS (all 7 tests). If the `handler` context type errors under Elysia's inferred types, widen the param type to `any` for the ctx destructure ONLY if strictly necessary — prefer the explicit shape above.

- [ ] **Step 5: Commit**

Invoke `/thunderpush` with message:
`feat(fork): OpenRouter free-tier route — server key, rotation, per-user throttle`

---

### Task 2: Replace default model catalog with the four free models

**Files:**
- Modify: `shared/defaults/models.ts`
- Create: `src/defaults/model-profiles/openrouter.ts`
- Modify: `src/defaults/model-profiles/index.ts`
- Modify: `shared/defaults/models.test.ts`

**Interfaces:**
- Produces: `defaultModels` = the four OpenRouter models; `defaultModelsVersion = 3`; four exported profiles.

- [ ] **Step 1: Replace the model definitions**

In `shared/defaults/models.ts`, replace the three existing `defaultModel*` consts (`defaultModelOpus48`, `defaultModelDeepseekV4Flash`, `defaultModelGlm52`) and the `defaultModels` array with the four models below, and bump the version. Keep the `SharedModel` type and `hashModel` unchanged.

```ts
export const defaultModelNemotron3Super: SharedModel = {
  id: '38e10634-2fbc-4323-b86d-3a5a6c0ca824',
  name: 'Nemotron 3 Super',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-super-120b-a12b:free',
  isSystem: 1,
  enabled: 1,
  isConfidential: 0,
  contextWindow: 262144,
  toolUsage: 1,
  startWithReasoning: 0,
  supportsParallelToolCalls: 0,
  deletedAt: null,
  url: null,
  defaultHash: null,
  vendor: 'nvidia',
  description: 'Free via OpenRouter — NVIDIA Nemotron 3 Super (120B)',
  userId: null,
}

export const defaultModelNemotron3Ultra: SharedModel = {
  id: 'd30990db-4d18-4713-8b08-ca8cabd206bb',
  name: 'Nemotron 3 Ultra',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  isSystem: 1,
  enabled: 1,
  isConfidential: 0,
  contextWindow: 1000000,
  toolUsage: 1,
  startWithReasoning: 0,
  supportsParallelToolCalls: 0,
  deletedAt: null,
  url: null,
  defaultHash: null,
  vendor: 'nvidia',
  description: 'Free via OpenRouter — NVIDIA Nemotron 3 Ultra (550B, 1M ctx)',
  userId: null,
}

export const defaultModelGemma431b: SharedModel = {
  id: '8a86bbe0-42a2-444c-aacf-7a8448262bb4',
  name: 'Gemma 4 31B',
  provider: 'openrouter',
  model: 'google/gemma-4-31b-it:free',
  isSystem: 1,
  enabled: 1,
  isConfidential: 0,
  contextWindow: 262144,
  toolUsage: 1,
  startWithReasoning: 0,
  supportsParallelToolCalls: 0,
  deletedAt: null,
  url: null,
  defaultHash: null,
  vendor: 'google',
  description: 'Free via OpenRouter — Google Gemma 4 (31B)',
  userId: null,
}

export const defaultModelNemotronNano9b: SharedModel = {
  id: 'b4db7251-0475-45bb-8dfa-05dbbaa961ca',
  name: 'Nemotron Nano 9B',
  provider: 'openrouter',
  model: 'nvidia/nemotron-nano-9b-v2:free',
  isSystem: 1,
  enabled: 1,
  isConfidential: 0,
  contextWindow: 128000,
  toolUsage: 1,
  startWithReasoning: 0,
  supportsParallelToolCalls: 0,
  deletedAt: null,
  url: null,
  defaultHash: null,
  vendor: 'nvidia',
  description: 'Free via OpenRouter — NVIDIA Nemotron Nano (9B)',
  userId: null,
}

export const defaultModels: ReadonlyArray<SharedModel> = [
  defaultModelNemotron3Super,
  defaultModelNemotron3Ultra,
  defaultModelGemma431b,
  defaultModelNemotronNano9b,
] as const

export const defaultModelsVersion = 3
```

Keep the header comment on `defaultModels` but update the "Retired between…" note to: `Retired in V3: the thunderbolt/tinfoil system models (Opus 4.8, DeepSeek V4 Flash, GLM 5.2) — replaced by free OpenRouter models under fresh ids; their rows are soft-deleted by cleanupRemovedDefaults on next reconcile.`

- [ ] **Step 2: Create the profiles**

Create `src/defaults/model-profiles/openrouter.ts` (one profile per model, cloned from the GLM profile shape; only `modelId` differs):

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ModelProfile } from '@/types'
import {
  defaultModelGemma431b,
  defaultModelNemotron3Super,
  defaultModelNemotron3Ultra,
  defaultModelNemotronNano9b,
} from '@shared/defaults/models'

const baseProfile = (modelId: string): ModelProfile => ({
  modelId,
  temperature: 0.2,
  maxSteps: 20,
  maxAttempts: 2,
  nudgeThreshold: 6,
  useSystemMessageModeDeveloper: 0,
  providerOptions: null,
  toolsOverride: null,
  linkPreviewsOverride: null,
  chatModeAddendum: null,
  searchModeAddendum: null,
  researchModeAddendum: null,
  citationReinforcementEnabled: 0,
  citationReinforcementPrompt: null,
  nudgeFinalStep: null,
  nudgePreventive: null,
  nudgeRetry: null,
  nudgeSearchFinalStep: null,
  nudgeSearchPreventive: null,
  nudgeSearchRetry: null,
  deletedAt: null,
  defaultHash: null,
  userId: null,
})

export const defaultModelProfileNemotron3Super = baseProfile(defaultModelNemotron3Super.id)
export const defaultModelProfileNemotron3Ultra = baseProfile(defaultModelNemotron3Ultra.id)
export const defaultModelProfileGemma431b = baseProfile(defaultModelGemma431b.id)
export const defaultModelProfileNemotronNano9b = baseProfile(defaultModelNemotronNano9b.id)
```

- [ ] **Step 3: Register the profiles**

Replace the body of `src/defaults/model-profiles/index.ts` imports/exports/array with (keep `hashModelProfile` unchanged):

```ts
import { hashValues } from '@/lib/utils'
import type { ModelProfile } from '@/types'
import {
  defaultModelProfileGemma431b,
  defaultModelProfileNemotron3Super,
  defaultModelProfileNemotron3Ultra,
  defaultModelProfileNemotronNano9b,
} from './openrouter'

export {
  defaultModelProfileGemma431b,
  defaultModelProfileNemotron3Super,
  defaultModelProfileNemotron3Ultra,
  defaultModelProfileNemotronNano9b,
} from './openrouter'

// ...hashModelProfile stays exactly as-is...

export const defaultModelProfiles: ReadonlyArray<ModelProfile> = [
  defaultModelProfileNemotron3Super,
  defaultModelProfileNemotron3Ultra,
  defaultModelProfileGemma431b,
  defaultModelProfileNemotronNano9b,
] as const
```

Then delete the now-unused profile files `src/defaults/model-profiles/opus.ts`, `deepseek.ts`, `glm.ts` (and any test that imports them — check `src/defaults/model-profiles/*.test.ts`). If a profiles snapshot/count test exists, update it.

- [ ] **Step 4: Update the version snapshot test (run-then-paste)**

First set the version in the expected object to 3 and run the test to read the actual hash:

Run: `bun test shared/defaults/models.test.ts`
Expected: FAIL — the assertion prints the actual `{ version: 3, hash: '0:38e10634…|1:d30990db…|2:8a86bbe0…|3:b4db7251…' }`.

Copy the printed `hash` string verbatim into `expected` in `shared/defaults/models.test.ts`, and set `expected.version = 3`:

```ts
const expected = {
  version: 3,
  hash: '<paste the exact hash from the test failure output>',
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test shared/defaults/models.test.ts`
Expected: PASS. Also run `bun test src/defaults/model-profiles` if any profile test exists — expected PASS.

- [ ] **Step 6: Typecheck**

Run: `bun run tsc --noEmit` (root) and `cd backend && bun run tsc --noEmit`
Expected: 0 errors. Fix any dangling imports of the deleted `defaultModelOpus48/DeepseekV4Flash/Glm52` consts (search the repo: `grep -rn "defaultModelOpus48\|defaultModelDeepseekV4Flash\|defaultModelGlm52\|defaultModelProfileOpus48\|defaultModelProfileDeepseekV4Flash\|defaultModelProfileGlm52" src backend shared`). Update references to the new consts or remove them.

- [ ] **Step 7: Commit**

Invoke `/thunderpush` with message:
`feat(fork): replace default model catalog with free OpenRouter models (v3)`

---

### Task 3: Thin hooks — mount route + route system models through it

**Files:**
- Modify: `backend/src/index.ts`
- Modify: `src/ai/fetch.ts`

**Interfaces:**
- Consumes: `createOpenrouterRoutes` (Task 1). Backend passes `{ auth, fetchFn, rateLimit: proRateLimit }`.

- [ ] **Step 1: Mount the route in the backend**

In `backend/src/index.ts`, add the import near the other route imports and one `.use(...)` line immediately after the tinfoil mount (`:132`):

```ts
import { createOpenrouterRoutes } from './fork/openrouter/routes'
```

```ts
      .use(createTinfoilRoutes({ auth, fetchFn, rateLimit: proRateLimit }))
      .use(createOpenrouterRoutes({ auth, fetchFn, rateLimit: proRateLimit }))
```

- [ ] **Step 2: Route system openrouter models through the backend key**

In `src/ai/fetch.ts`, in the `case 'openrouter':` block of `createModel` (~`:462`), insert an `isSystem` branch BEFORE the existing `resolveOpenAiCompatConnection` call, mirroring the tinfoil system block (`:482-516`) but without the HPKE client:

```ts
    case 'openrouter': {
      if (modelConfig.isSystem) {
        // System OpenRouter models proxy through the backend, which injects the
        // server key. Placeholder apiKey satisfies the SDK; the wrapped fetch
        // carries the real Thunderbolt session token so the route's auth guard
        // passes (Bearer for token auth, cookies for SSO web).
        const cloudUrl = getLocalSetting('cloudUrl')
        const sso = isSsoMode()
        const token = getAuthToken()
        const wrappedFetch: typeof fetch = Object.assign(
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
        const openrouter = createOpenAICompatible({
          name: 'openrouter',
          baseURL: `${cloudUrl}/openrouter`,
          apiKey: 'thunderbolt-managed',
          fetch: wrappedFetch,
        })
        return openrouter(modelConfig.model)
      }
      const conn = resolveOpenAiCompatConnection(modelConfig, getProxyFetch)
      if (!conn) {
        throw new Error('No API key provided')
      }
      // ...existing BYOK openrouter body unchanged...
```

Confirm `getLocalSetting`, `isSsoMode`, `getAuthToken`, `createOpenAICompatible` are already imported in `fetch.ts` (they are — used by the `thunderbolt` and `tinfoil` blocks). No new imports needed.

- [ ] **Step 3: Typecheck + backend route test still green**

Run: `bun run tsc --noEmit` (root) and `cd backend && bun run tsc --noEmit`
Expected: 0 errors.
Run: `cd backend && bun test src/fork/openrouter/routes.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 4: Commit**

Invoke `/thunderpush` with message:
`feat(fork): mount OpenRouter route + route system models through server key`

---

### Task 4: Config wiring + docs

**Files:**
- Modify: `powersync-service/docker-compose.yml`
- Modify: `dev-local/docker/README-web-demo.md`

**Interfaces:**
- Consumes: the mounted route (Task 3) and its env vars.

- [ ] **Step 1: Add env to the compose backend**

In `powersync-service/docker-compose.yml`, in the `backend.environment` block (after the Phase-1 additions), add:

```yaml
      # Free OpenRouter models for the demo (server-side key, rotated). Comma-
      # separated keys; ideally from DIFFERENT OpenRouter accounts so the
      # per-account free-tier limit actually multiplies. Empty ⇒ models 503 on use.
      OPENROUTER_API_KEYS: ${OPENROUTER_API_KEYS:-}
      OPENROUTER_FREE_RPM: ${OPENROUTER_FREE_RPM:-10}
```

- [ ] **Step 2: Document in the README**

In `dev-local/docker/README-web-demo.md`, add rows to the env table and a short "Free models (OpenRouter)" section:

```markdown
| `OPENROUTER_API_KEYS` | _(empty)_ | Comma-separated OpenRouter API keys for the free system models. The backend injects them server-side and rotates on rate-limit. Use keys from **different OpenRouter accounts** for the free-tier limit to actually multiply. Empty ⇒ the models return 503 on use. |
| `OPENROUTER_FREE_RPM` | `10` | Per-user requests/minute cap on the free models (in-memory throttle). |

## Free models (OpenRouter)

Anonymous demo users chat with four free OpenRouter models (Nemotron 3 Super/Ultra,
Gemma 4 31B, Nemotron Nano 9B) via a backend-held key — no BYOK. Set
`OPENROUTER_API_KEYS` in `backend/.env` before starting the stack. Real users can
still add their own BYOK models.
```

- [ ] **Step 3: Validate compose config**

Run: `OPENROUTER_API_KEYS=test docker compose -f powersync-service/docker-compose.yml config >/dev/null && echo OK`
Expected: `OK`, and `... config | grep OPENROUTER` shows both vars resolved on the backend service.

- [ ] **Step 4: Commit**

Invoke `/thunderpush` with message:
`chore(dev): wire OPENROUTER_API_KEYS/FREE_RPM into demo compose + docs`

---

## Integration verification (controller, after all tasks + rebuild-master)

1. `pwsh dev-local/rebuild-master.ps1` (HUSKY=0) → master rebuilt clean, typecheck 0.
2. Put a real key in `backend/.env`: `OPENROUTER_API_KEYS=sk-or-...`.
3. `PUBLIC_URL=http://localhost:3000 docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml up -d --build`.
4. Open `http://localhost:3000` as an anonymous user → the four free models appear; **Nemotron 3 Super** is the default selection.
5. Send a chat message → streamed reply arrives (server key injected; no BYOK).
6. `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/v1/openrouter/chat/completions -H 'content-type: application/json' -d '{}'` with a valid anonymous session repeated past `OPENROUTER_FREE_RPM` → `429`.

## Self-Review

**Spec coverage:** server-key route (Task 1) ✓; rotation + throttle (Task 1) ✓; four-model catalog replace + version bump + snapshot (Task 2) ✓; thin hooks index.ts + fetch.ts (Task 3) ✓; config/docs (Task 4) ✓; no `settings.ts` edit (route reads env) ✓; fork boundary named files only ✓.

**Placeholder scan:** the snapshot `hash` in Task 2 Step 4 is intentionally run-then-paste (the test is designed this way; the value cannot be known before running). Everything else is concrete.

**Type/name consistency:** `createOpenrouterRoutes` + `CreateOpenrouterRoutesOptions` consistent across Tasks 1 and 3; model const names (`defaultModelNemotron3Super`, etc.) and profile names consistent across Task 2 files; ids match the Global Constraints block; env var names (`OPENROUTER_API_KEYS`, `OPENROUTER_FREE_RPM`, `OPENROUTER_BASE_URL`) consistent across Tasks 1 and 4.
