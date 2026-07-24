# SearXNG Search + Firecrawl Scrape — Phase 3b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Route the demo's web search to a self-hosted SearXNG and page fetch/scrape to the user's self-hosted Firecrawl Simple, replacing Exa, so anonymous demo users get free web search + page reading.

**Architecture:** Two upstream backend handlers gain a one-line fork guard that delegates to a fork module when the provider env is set (Exa stays as fallback). SearXNG + Firecrawl run as docker services in the demo stack. Frontend tools/DTOs are untouched.

**Tech Stack:** Elysia (Bun), SearXNG JSON API, Firecrawl `/v1/scrape`, `bun test`, Docker Compose.

## Global Constraints

- **Fork boundary / branches:** additive fork modules (`backend/src/fork/search/searxng.ts`, `backend/src/fork/firecrawl/scrape.ts` + tests) → `fork/additive`. Invasive one-line hooks in `backend/src/api/search.ts` and `backend/src/pro/exa.ts` → `fork/hooks`. Compose + `searxng/settings.yml` + README → `fork/dev`. NO frontend edits, NO `settings.ts` edit (modules read `process.env`). Assembled onto `master` by `dev-local/rebuild-master.ps1`; the controller handles branch/commit/rebuild.
- **DTO contracts (must match exactly):** search → `SearchResultDto = { title, pageUrl, faviconUrl: string|null, previewImageUrl: string|null }` (`backend/src/api/search.ts:14`). scrape → `FetchContentResponse = { data: FetchContentData|null, success, error? }` (`backend/src/pro/types.ts:16`); the frontend reads `{ url, title, text, isTruncated?, favicon, image, author, published_date }` (`src/integrations/thunderbolt-pro/schemas.ts:64`).
- **Env:** `SEARXNG_URL` (e.g. `http://searxng:8080`), `FIRECRAWL_URL` (e.g. `http://firecrawl-api:3002`), `FIRECRAWL_TOKEN` (any UUID; Firecrawl only validates UUID format). Empty ⇒ handler falls back to Exa.
- **Firecrawl images** are built locally from `E:\firecrawl-simple` and tagged `trieve/firecrawl` + `trieve/puppeteer-service-ts` (Phase 3a later retags to `ghcr.io/metalmon`).
- **Backend host tests:** run `cd backend && bun install` first (pre-existing `@better-auth/api-key` local-install gotcha), then `bun test`.
- **Commits:** `/thunderpush` only. Windows fork git config already `autocrlf=false, eol=lf`.

---

### Task 1: Firecrawl scrape fork module

**Files:**
- Create: `backend/src/fork/firecrawl/scrape.ts`
- Test: `backend/src/fork/firecrawl/scrape.test.ts`

**Interfaces:**
- Produces: `getFirecrawlUrl(): string` and `forkFirecrawlScrape(url: string, maxLength: number | undefined, fetchFn?: typeof fetch): Promise<FetchContentResponse>`. Task 3 imports both into `backend/src/pro/exa.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/fork/firecrawl/scrape.test.ts`:

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { forkFirecrawlScrape, getFirecrawlUrl } from './scrape'

const origUrl = process.env.FIRECRAWL_URL
const origTok = process.env.FIRECRAWL_TOKEN
afterEach(() => {
  process.env.FIRECRAWL_URL = origUrl
  process.env.FIRECRAWL_TOKEN = origTok
})

const scrapeResponse = (markdown: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ success: true, data: { markdown, metadata: { title: 'T', sourceURL: 'https://x/y', ...extra } } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('forkFirecrawlScrape', () => {
  it('getFirecrawlUrl strips a trailing slash and reads env', () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002/'
    expect(getFirecrawlUrl()).toBe('http://fc:3002')
  })

  it('POSTs /v1/scrape with a Bearer UUID and markdown format, maps to FetchContentData', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    process.env.FIRECRAWL_TOKEN = '11111111-1111-4111-8111-111111111111'
    const fetchFn = mock(() => Promise.resolve(scrapeResponse('# Hello world')))
    const res = await forkFirecrawlScrape('https://x/y', 16000, fetchFn as unknown as typeof fetch)
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://fc:3002/v1/scrape')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer 11111111-1111-4111-8111-111111111111')
    expect(JSON.parse(init.body as string).formats).toEqual(['markdown'])
    expect(res.success).toBe(true)
    expect(res.data?.text).toContain('Hello world')
    expect(res.data?.title).toBe('T')
    expect(res.data?.url).toBe('https://x/y')
  })

  it('truncates markdown beyond maxLength and appends the hint', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    const big = 'a'.repeat(5000)
    const fetchFn = mock(() => Promise.resolve(scrapeResponse(big)))
    const res = await forkFirecrawlScrape('https://x/y', 1000, fetchFn as unknown as typeof fetch)
    expect(res.data?.isTruncated).toBe(true)
    expect(res.data?.text).toContain('[Content truncated')
    expect(res.data?.text.length).toBeLessThan(5000)
  })

  it('returns {data:null,success:true} for empty markdown', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    const fetchFn = mock(() => Promise.resolve(scrapeResponse('')))
    const res = await forkFirecrawlScrape('https://x/y', 16000, fetchFn as unknown as typeof fetch)
    expect(res).toEqual({ data: null, success: true })
  })

  it('returns success:false on a non-OK upstream', async () => {
    process.env.FIRECRAWL_URL = 'http://fc:3002'
    const fetchFn = mock(() => Promise.resolve(new Response('nope', { status: 502 })))
    const res = await forkFirecrawlScrape('https://x/y', 16000, fetchFn as unknown as typeof fetch)
    expect(res.success).toBe(false)
    expect(res.data).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun install && bun test ./src/fork/firecrawl/scrape.test.ts`
Expected: FAIL — `Cannot find module './scrape'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/fork/firecrawl/scrape.ts`:

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { FetchContentResponse } from '@/pro/types'

const DEFAULT_MAX = 16_000
const HARD_CAP = 64_000
const MIN = 1_000
// Firecrawl Simple only validates the Bearer token as a UUID (no key store), so
// any UUID works; override with FIRECRAWL_TOKEN.
const DEFAULT_TOKEN = '00000000-0000-4000-8000-000000000000'

/** Base URL of the self-hosted Firecrawl, or '' when unconfigured (→ Exa fallback). */
export const getFirecrawlUrl = (): string => (process.env.FIRECRAWL_URL ?? '').replace(/\/$/, '')

type FirecrawlScrapeResponse = {
  success?: boolean
  data?: {
    markdown?: string
    metadata?: { title?: string; sourceURL?: string; author?: string }
  }
}

/**
 * Fetch a page's readable markdown via self-hosted Firecrawl `POST /v1/scrape`
 * and map it to the `FetchContentResponse` the `/pro/fetch-content` handler
 * returns (so the frontend `fetch_content` tool is untouched).
 */
export const forkFirecrawlScrape = async (
  url: string,
  maxLength: number | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<FetchContentResponse> => {
  const base = getFirecrawlUrl()
  const token = process.env.FIRECRAWL_TOKEN || DEFAULT_TOKEN
  const maxChars = Math.min(Math.max(maxLength ?? DEFAULT_MAX, MIN), HARD_CAP)

  const res = await fetchFn(`${base}/v1/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url, formats: ['markdown'], timeout: 30_000, blockMedia: true }),
  })
  if (!res.ok) {
    return { data: null, success: false, error: `Firecrawl scrape failed (${res.status})` }
  }

  const json = (await res.json()) as FirecrawlScrapeResponse
  const markdown = json.data?.markdown ?? ''
  if (!markdown) {
    return { data: null, success: true }
  }

  const isTruncated = markdown.length >= maxChars
  const hint =
    isTruncated && maxChars < HARD_CAP
      ? `\n\n[Content truncated. Call fetch_content with max_length=${Math.min(maxChars * 2, HARD_CAP)} for more.]`
      : ''

  const data = {
    url: json.data?.metadata?.sourceURL ?? url,
    title: json.data?.metadata?.title ?? null,
    text: markdown.slice(0, maxChars) + hint,
    isTruncated,
    favicon: null,
    image: null,
    author: json.data?.metadata?.author ?? null,
    published_date: null,
  }
  // The backend FetchContentData is exa-js's SearchResult shape, but the wire
  // contract the frontend consumes is this subset — cast past the exa type.
  return { data: data as unknown as NonNullable<FetchContentResponse['data']>, success: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && bun test ./src/fork/firecrawl/scrape.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** — `/thunderpush`: `feat(fork): Firecrawl scrape provider for /pro/fetch-content`

---

### Task 2: SearXNG search fork module

**Files:**
- Create: `backend/src/fork/search/searxng.ts`
- Test: `backend/src/fork/search/searxng.test.ts`

**Interfaces:**
- Produces: `getSearxngUrl(): string` and `forkSearxngSearch(q: string, limit: number | undefined, fetchFn?: typeof fetch): Promise<SearchResultDto[]>`. Task 3 imports both into `backend/src/api/search.ts`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/fork/search/searxng.test.ts`:

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { forkSearxngSearch, getSearxngUrl } from './searxng'

const orig = process.env.SEARXNG_URL
afterEach(() => {
  process.env.SEARXNG_URL = orig
})

const jsonResults = (results: unknown[]) =>
  new Response(JSON.stringify({ results }), { status: 200, headers: { 'content-type': 'application/json' } })

describe('forkSearxngSearch', () => {
  it('getSearxngUrl strips a trailing slash and reads env', () => {
    process.env.SEARXNG_URL = 'http://searxng:8080/'
    expect(getSearxngUrl()).toBe('http://searxng:8080')
  })

  it('queries /search?format=json and maps results to SearchResultDto', async () => {
    process.env.SEARXNG_URL = 'http://searxng:8080'
    const fetchFn = mock(() =>
      Promise.resolve(jsonResults([{ url: 'https://a.com/p', title: 'A', img_src: 'https://a.com/i.png' }])),
    )
    const out = await forkSearxngSearch('cats', 10, fetchFn as unknown as typeof fetch)
    const [url] = fetchFn.mock.calls[0] as [string]
    expect(url).toContain('http://searxng:8080/search?q=cats')
    expect(url).toContain('format=json')
    expect(out[0]).toEqual({
      title: 'A',
      pageUrl: 'https://a.com/p',
      faviconUrl: expect.any(String),
      previewImageUrl: 'https://a.com/i.png',
    })
  })

  it('clamps to the limit and drops non-https results', async () => {
    process.env.SEARXNG_URL = 'http://searxng:8080'
    const fetchFn = mock(() =>
      Promise.resolve(
        jsonResults([
          { url: 'http://insecure.com', title: 'no' },
          { url: 'https://a.com', title: 'a' },
          { url: 'https://b.com', title: 'b' },
        ]),
      ),
    )
    const out = await forkSearxngSearch('x', 1, fetchFn as unknown as typeof fetch)
    expect(out).toHaveLength(1)
    expect(out[0].pageUrl).toBe('https://a.com/')
  })

  it('returns [] on a non-OK upstream', async () => {
    process.env.SEARXNG_URL = 'http://searxng:8080'
    const fetchFn = mock(() => Promise.resolve(new Response('err', { status: 500 })))
    expect(await forkSearxngSearch('x', 10, fetchFn as unknown as typeof fetch)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && bun test ./src/fork/search/searxng.test.ts`
Expected: FAIL — `Cannot find module './searxng'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/fork/search/searxng.ts`:

```ts
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { SearchResultDto } from '@/api/search'
import { ensureHttps } from '@/utils/url-validation'
import { deriveFaviconUrl } from '@shared/url'

/** Base URL of the self-hosted SearXNG, or '' when unconfigured (→ Exa fallback). */
export const getSearxngUrl = (): string => (process.env.SEARXNG_URL ?? '').replace(/\/$/, '')

type SearxngResult = { url?: string; title?: string; img_src?: string }
type SearxngResponse = { results?: SearxngResult[] }

/**
 * Run a web search via self-hosted SearXNG's JSON API and map results to the
 * `SearchResultDto[]` the `/search` handler returns (frontend `search` tool
 * untouched). https-only, favicon derived from the result host.
 */
export const forkSearxngSearch = async (
  q: string,
  limit: number | undefined,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<SearchResultDto[]> => {
  const base = getSearxngUrl()
  const n = limit ? Math.min(Math.max(limit, 1), 25) : 10
  const url = `${base}/search?q=${encodeURIComponent(q)}&format=json&safesearch=1`

  const res = await fetchFn(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    return []
  }
  const json = (await res.json()) as SearxngResponse

  const out: SearchResultDto[] = []
  for (const r of json.results ?? []) {
    if (out.length >= n) {
      break
    }
    const pageUrl = ensureHttps(r.url ?? null)
    if (!pageUrl) {
      continue
    }
    out.push({
      title: r.title ?? new URL(pageUrl).hostname,
      pageUrl,
      faviconUrl: deriveFaviconUrl(pageUrl),
      previewImageUrl: ensureHttps(r.img_src ?? null),
    })
  }
  return out
}
```

Note: `import type { SearchResultDto }` is erased at compile time, so the value import of this module by `search.ts` (Task 3) creates no runtime cycle.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && bun test ./src/fork/search/searxng.test.ts`
Expected: PASS (4 tests). If `ensureHttps`/`deriveFaviconUrl` signatures differ, adjust — confirm against `backend/src/utils/url-validation.ts` and `shared/url.ts` (they are the same helpers `search.ts` uses at lines 9-10, 57-61).

- [ ] **Step 5: Commit** — `/thunderpush`: `feat(fork): SearXNG search provider for /v1/search`

---

### Task 3: Thin hooks in the two upstream handlers

**Files:**
- Modify: `backend/src/api/search.ts`
- Modify: `backend/src/pro/exa.ts`

**Interfaces:**
- Consumes: Task 1 (`getFirecrawlUrl`, `forkFirecrawlScrape`) and Task 2 (`getSearxngUrl`, `forkSearxngSearch`).

- [ ] **Step 1: Hook the search handler**

In `backend/src/api/search.ts`, add the import and one guard at the top of the `/search` handler (right after `limit` is computed, before `const client = ...`):

```ts
import { forkSearxngSearch, getSearxngUrl } from '@/fork/search/searxng'
```

```ts
          const limit = query.limit ? Math.min(Math.max(query.limit, 1), 25) : 10

          if (getSearxngUrl()) {
            return { results: await forkSearxngSearch(query.q, limit) }
          }

          const client = deps.exaClient ?? getExaClient()
```

- [ ] **Step 2: Hook the fetch-content handler**

In `backend/src/pro/exa.ts`, add the import and one guard as the first statement of the `/fetch-content` handler (before the `store.exaClient` check):

```ts
import { forkFirecrawlScrape, getFirecrawlUrl } from '@/fork/firecrawl/scrape'
```

```ts
    async ({ body, store }): Promise<FetchContentResponse> => {
      if (getFirecrawlUrl()) {
        return forkFirecrawlScrape(body.url, body.max_length)
      }

      if (!store.exaClient) {
        throw new Error('Fetch content service is not configured.')
      }
```

- [ ] **Step 3: Typecheck (frontend + backend)**

Run: `bunx tsc --noEmit -p tsconfig.json` (root) — expect clean except pre-existing `@/fork/*` cross-branch errors when run on a single fork branch (resolve on assembled master).
Run: `cd backend && bunx tsc --noEmit` — expect zero errors except the pre-existing `@better-auth/api-key` one; NO new errors in `search.ts`/`exa.ts`.
Run: `cd backend && bun test ./src/fork/search/searxng.test.ts ./src/fork/firecrawl/scrape.test.ts` — expect PASS.

- [ ] **Step 4: Commit** — `/thunderpush`: `feat(fork): route /v1/search and fetch-content through SearXNG/Firecrawl when configured`

---

### Task 4: Infra — SearXNG + Firecrawl services + config

**Files:**
- Create: `powersync-service/searxng/settings.yml`
- Modify: `powersync-service/docker-compose.yml`
- Modify: `powersync-service/openrouter.env.example` and the git-ignored `powersync-service/openrouter.env` (add the new demo env vars — reuse the existing git-ignored secrets file)
- Modify: `dev-local/docker/README-web-demo.md`

**Interfaces:**
- Consumes: the mounted hooks (Task 3) + fork modules (Tasks 1–2). Provides the `searxng` + `firecrawl-*` services and the `SEARXNG_URL`/`FIRECRAWL_URL`/`FIRECRAWL_TOKEN` env.

- [ ] **Step 1: Build the Firecrawl images locally (one-time, from E:)**

Run:
```bash
docker compose -f /e/firecrawl-simple/docker-compose.yaml build
```
Expected: builds images tagged `trieve/firecrawl` and `trieve/puppeteer-service-ts`. Confirm: `docker images | grep -E "trieve/firecrawl|trieve/puppeteer-service-ts"`. (Phase 3a will retag/push these to `ghcr.io/metalmon` and swap the `image:` refs below.)

- [ ] **Step 2: Create the SearXNG settings**

Create `powersync-service/searxng/settings.yml`:

```yaml
# Minimal SearXNG config for the demo: inherit defaults, enable JSON output so
# the backend can consume results, and disable the limiter for internal calls.
use_default_settings: true
server:
  secret_key: "thunderbolt-demo-searxng-secret-change-me"
  limiter: false
  image_proxy: false
search:
  safe_search: 1
  formats:
    - html
    - json
```

- [ ] **Step 3: Add the services to the compose**

In `powersync-service/docker-compose.yml`, add under `services:` (locally-built Firecrawl images; internal-only ports):

```yaml
  searxng:
    restart: unless-stopped
    image: searxng/searxng:latest
    volumes:
      - ./searxng/settings.yml:/etc/searxng/settings.yml:ro
    environment:
      SEARXNG_BASE_URL: http://localhost:8080/

  firecrawl-redis:
    restart: unless-stopped
    image: redis:alpine
    command: redis-server --bind 0.0.0.0

  firecrawl-puppeteer:
    restart: unless-stopped
    image: trieve/puppeteer-service-ts   # built locally from E:\firecrawl-simple (Phase 3a → ghcr)
    dns:
      - 1.1.1.1
      - 8.8.8.8
    environment:
      PORT: "3000"
      MAX_CONCURRENCY: "2"

  firecrawl-api:
    restart: unless-stopped
    image: trieve/firecrawl               # built locally from E:\firecrawl-simple (Phase 3a → ghcr)
    depends_on:
      - firecrawl-redis
      - firecrawl-puppeteer
    environment:
      REDIS_URL: redis://firecrawl-redis:6379
      REDIS_RATE_LIMIT_URL: redis://firecrawl-redis:6379
      PLAYWRIGHT_MICROSERVICE_URL: http://firecrawl-puppeteer:3000/scrape
      PORT: "3002"
      HOST: 0.0.0.0
      BULL_AUTH_KEY: thunderbolt-demo-bull
      TEST_API_KEY: ""
    command: ["pnpm", "run", "start:production"]

  firecrawl-worker:
    restart: unless-stopped
    image: trieve/firecrawl
    depends_on:
      - firecrawl-redis
      - firecrawl-puppeteer
      - firecrawl-api
    environment:
      REDIS_URL: redis://firecrawl-redis:6379
      REDIS_RATE_LIMIT_URL: redis://firecrawl-redis:6379
      PLAYWRIGHT_MICROSERVICE_URL: http://firecrawl-puppeteer:3000/scrape
      PORT: "3002"
      HOST: 0.0.0.0
      BULL_AUTH_KEY: thunderbolt-demo-bull
    command: ["pnpm", "run", "workers"]
```

Add `depends_on` on the `backend` service for `searxng` and `firecrawl-api` (so they start with the stack):

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      searxng:
        condition: service_started
      firecrawl-api:
        condition: service_started
```

- [ ] **Step 4: Wire the backend env (git-ignored secrets file)**

Append to the git-ignored `powersync-service/openrouter.env` (and the tracked `openrouter.env.example` with placeholder values):

```bash
# Self-hosted search + scrape (Phase 3). Empty ⇒ falls back to Exa.
SEARXNG_URL=http://searxng:8080
FIRECRAWL_URL=http://firecrawl-api:3002
FIRECRAWL_TOKEN=00000000-0000-4000-8000-000000000000
```

(The backend service already loads `openrouter.env` via `env_file`, so no `environment:` change is needed — these reach `process.env` in the fork modules.)

- [ ] **Step 5: Validate compose config**

Run: `docker compose -f powersync-service/docker-compose.yml config >/dev/null && echo OK`
Expected: `OK`; `... config | grep -E "searxng|firecrawl"` shows the five new services.

- [ ] **Step 6: Document in the README**

In `dev-local/docker/README-web-demo.md`, add a "Web search + scrape (Phase 3)" section: SearXNG provides free JSON search, Firecrawl (local images from `E:\firecrawl-simple`, built via its own compose) scrapes pages; env vars `SEARXNG_URL`/`FIRECRAWL_URL`/`FIRECRAWL_TOKEN` live in `openrouter.env`; unset ⇒ Exa fallback. Note Phase 3a will publish the Firecrawl images to ghcr.

- [ ] **Step 7: Commit** — `/thunderpush`: `chore(dev): add SearXNG + Firecrawl services and search/scrape env to demo`

---

## Integration verification (controller, after rebuild-master + local Firecrawl images)

1. `pwsh dev-local/rebuild-master.ps1` (HUSKY=0) → master rebuilt clean; `cd backend && bun install` then `bun test ./src/fork/search ./src/fork/firecrawl` = green; tsc clean.
2. `PUBLIC_URL=http://localhost:3000 docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml up -d --build` → all services up.
3. SearXNG JSON directly: `docker compose ... exec backend sh -c 'wget -qO- "http://searxng:8080/search?q=test&format=json" | head -c 200'` → JSON with `results`.
4. Firecrawl scrape directly: from the backend container, `POST http://firecrawl-api:3002/v1/scrape` with `Authorization: Bearer 00000000-0000-4000-8000-000000000000` body `{"url":"https://example.com","formats":["markdown"]}` → `{success:true,data:{markdown:...}}`.
5. Through the app: as an anonymous demo user, ask something that triggers `search` → sources come from SearXNG; then a `fetch_content` on a result → markdown from Firecrawl. Verify in chat + `docker compose ... logs backend`.

## Self-Review

**Spec coverage:** search→SearXNG (Task 2+3) ✓; scrape→Firecrawl (Task 1+3) ✓; fork modules read env, Exa fallback (Tasks 1–2 guards) ✓; infra services + settings.yml + env (Task 4) ✓; no frontend/settings.ts edit ✓; DTO contracts matched (SearchResultDto, FetchContentResponse) ✓; Pro-gating untouched (already on) ✓.

**Placeholder scan:** all code/config concrete. `searxng/settings.yml` secret + `FIRECRAWL_TOKEN` are demo defaults (documented as changeable). No TBDs.

**Type/name consistency:** `getFirecrawlUrl`/`forkFirecrawlScrape` and `getSearxngUrl`/`forkSearxngSearch` consistent across Tasks 1–3. `SearchResultDto` fields match `search.ts:14`; `FetchContentResponse` shape matches `pro/types.ts:16`. Env var names (`SEARXNG_URL`, `FIRECRAWL_URL`, `FIRECRAWL_TOKEN`) consistent across Tasks 1, 2, 4. Compose service names (`searxng`, `firecrawl-api`, `firecrawl-redis`, `firecrawl-puppeteer`, `firecrawl-worker`) match the env URLs.
