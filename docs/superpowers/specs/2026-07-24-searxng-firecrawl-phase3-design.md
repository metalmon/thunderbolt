# Self-Hosted Search (SearXNG) + Scrape (Firecrawl) — Phase 3 Design

**Date:** 2026-07-24
**Status:** Approved for implementation planning (Phase 3b)
**Fork:** metalmon/thunderbolt (fork of thunderbird/thunderbolt, MPL-2.0)
**Depends on:** Phases 1–2 (dockerized demo + OpenRouter free models) on `master`.

## Goal

Give the anonymous demo working **web search** and **page fetch/scrape** with no
paid API, by routing:
- **search** → a self-hosted **SearXNG** container (JSON results, aggregates
  Google/Bing/DDG, no keys), replacing the upstream **Exa** search;
- **page fetch/scrape** → the user's self-hosted **Firecrawl Simple** fork
  (`POST /v1/scrape` → markdown), replacing the upstream **Exa `getContents()`**.

The classic AI-search pipeline: SearXNG finds URLs → Firecrawl scrapes their
content → the LLM reads it.

## Roadmap context

- Phase 3a (firecrawl-simple repo on `E:`, DEFERRED): CI/build → push api +
  puppeteer images to `ghcr.io/metalmon`.
- **Phase 3b (this doc, NOW): thunderbolt fork** — SearXNG + Firecrawl services in
  the demo compose (locally-built Firecrawl images for now), backend seams,
  config. Both search and scrape ship together.

## Key facts established

- **Pro-gating is a non-issue.** `isProUser = true` is hardcoded
  (`src/integrations/thunderbolt-pro/utils.ts:8`); all users (incl. anonymous
  demo) already get `['search','web_fetch',...]`. The `search` and `fetch_content`
  tools are already available — no ungating needed.
- **Firecrawl Simple does NOT do web search** — only `/v1/scrape` + crawl/map.
  Search therefore uses SearXNG, not Firecrawl.
- Both backend features are single, isolated handlers with stable response DTOs;
  the frontend tools/schemas/HTTP paths are the contract and stay untouched.

## Architecture

```
 LLM tool "search"  → GET /v1/search  → forkSearch  → SearXNG (JSON) → SearchResultDto[]
 LLM tool "fetch_content" → POST /v1/pro/fetch-content → forkScrape → Firecrawl /v1/scrape → FetchContentData
```

### Backend seams (thin hooks + additive fork modules)

Both handlers are upstream files → thin-hook rule: the invasive edit is one guard
+ one `forkX(...)` call; the provider logic lives in `src/fork/**`.

- **Search** — `backend/src/api/search.ts` (`GET /search`, `:39-79`). Add at the
  top of the handler: `if (getSearxngUrl()) return forkSearxngSearch(q, limit)`.
  The fork module calls SearXNG and maps to `SearchResultDto`
  (`{title, pageUrl, faviconUrl, previewImageUrl}`, search.ts:14). Exa stays as
  the fallback when `SEARXNG_URL` is unset.
- **Scrape** — `backend/src/pro/exa.ts` fetch-content handler (`:27-76`). Add:
  `if (getFirecrawlUrl()) return forkFirecrawlScrape(url, maxCharacters)`. The
  fork module calls Firecrawl `POST /v1/scrape` with `formats:['markdown']` and a
  Bearer UUID, maps `data.markdown` → `FetchContentData.text` (+ title from
  `data.metadata.title`), preserving the `{success, data}` shape. Exa stays as
  the fallback when `FIRECRAWL_URL` is unset.

### Additive fork modules (`fork/additive`)

- `backend/src/fork/search/searxng.ts` — `forkSearxngSearch(q, limit)`:
  `GET ${SEARXNG_URL}/search?q=&format=json&safesearch=1&language=…`, map
  `results[]` (`{title, url, img_src?, …}`) → `SearchResultDto[]` (clamp to limit).
  Reads `process.env.SEARXNG_URL` directly (no `settings.ts` edit).
- `backend/src/fork/firecrawl/scrape.ts` — `forkFirecrawlScrape(url, maxChars)`:
  `POST ${FIRECRAWL_URL}/v1/scrape` `Authorization: Bearer ${FIRECRAWL_TOKEN}`
  (any UUID; default a fixed demo UUID), body `{url, formats:['markdown'],
  timeout, blockMedia:true}`; truncate markdown to `maxChars`, map to
  `FetchContentData`. Reads `process.env.FIRECRAWL_URL`/`FIRECRAWL_TOKEN`.
- Each with a colocated `.test.ts` (injected `fetchFn`, mapping + truncation +
  error cases). NOTE: backend host `bun test` needs `cd backend && bun install`
  first (see the api-key gotcha from Phase 2).

### Config

Read directly from `process.env` in the fork modules (mirrors the Phase-2
OpenRouter route — no `backend/src/config/settings.ts` edit):
- `SEARXNG_URL` (e.g. `http://searxng:8080`)
- `FIRECRAWL_URL` (e.g. `http://firecrawl-api:3002`)
- `FIRECRAWL_TOKEN` (any UUID; default a fixed demo UUID)

Empty ⇒ the handler falls back to Exa (upstream behavior) — the app still runs.

### Infra (demo compose — `fork/dev`)

Add to `powersync-service/docker-compose.yml`:
- **`searxng`** — image `searxng/searxng:latest`, port not published (internal),
  config bind-mount `./searxng/settings.yml` enabling `formats: [html, json]` +
  a `server.secret_key`. No keys.
- **Firecrawl (4 services)** — `firecrawl-api` (`:3002`, image built locally from
  `E:\firecrawl-simple` and tagged, e.g. `firecrawl-simple-api:local`),
  `firecrawl-worker` (same image, worker command), `firecrawl-redis`
  (`redis:alpine`), `firecrawl-puppeteer` (`firecrawl-simple-puppeteer:local`).
  Env per the fork's compose (`REDIS_URL`, `PLAYWRIGHT_MICROSERVICE_URL`, `PORT`,
  `BULL_AUTH_KEY`, `TEST_API_KEY`). **Phase 3a** swaps the `:local` tags for
  `ghcr.io/metalmon/...` pulls.
- **backend env**: `SEARXNG_URL=http://searxng:8080`,
  `FIRECRAWL_URL=http://firecrawl-api:3002`, `FIRECRAWL_TOKEN=<uuid>` — added via
  the git-ignored `secrets.env` sibling or a new `demo.env` (git-ignored) /
  compose `environment`. (Decide in plan; keep secrets out of git.)
- New config files (`searxng/settings.yml`) are fork additive dev files.

## Fork boundary

- **Additive** (`fork/additive`): `backend/src/fork/search/searxng.ts`,
  `backend/src/fork/firecrawl/scrape.ts` (+ tests).
- **Invasive thin hooks** (`fork/hooks`): the two guard-lines in
  `backend/src/api/search.ts` and `backend/src/pro/exa.ts`.
- **Dev infra** (`fork/dev`): compose services + `searxng/settings.yml` + README.
- No frontend edits (tools/schemas/DTOs unchanged). No `settings.ts` edit.

## Non-goals (Phase 3b)

- No Firecrawl crawl/map integration (only single-page scrape for `fetch_content`).
- No ghcr publishing / CI (that is Phase 3a).
- No change to the frontend search UI/mode or the tool definitions.
- No Pro-gating changes (already hardcoded on).

## Known items / to resolve in the plan

- Exact SearXNG `results[]` → `SearchResultDto` field mapping (favicon/preview
  image may be absent; derive favicon from the result host).
- Firecrawl scrape error/timeout handling → map to the same error shape the Exa
  handler returns so the tool degrades gracefully.
- SearXNG `settings.yml` minimal content (enable JSON, set secret, pick engines).
- Where to put the new demo env vars without committing secrets.

## Testing / verification

1. Unit: `searxng.ts` + `scrape.ts` fork-module tests (injected fetch) — mapping,
   truncation, limit clamp, error fallback. Run after `cd backend && bun install`.
2. Integration (docker, after `rebuild-master` + local Firecrawl images):
   - Bring up stack incl. searxng + firecrawl. Confirm `searxng` returns JSON for
     `/search?q=test&format=json` and `firecrawl-api` scrapes a URL to markdown.
   - As an anonymous demo user, ask a question that triggers the `search` tool →
     results come from SearXNG; a follow-up `fetch_content` → content from
     Firecrawl. Verify in the chat + backend logs.

## Success criteria

- Anonymous demo user runs a web search (SearXNG) and reads a fetched page
  (Firecrawl markdown) — no paid API, no key.
- Exa remains the fallback when `SEARXNG_URL`/`FIRECRAWL_URL` are unset.
- Only the named files changed; frontend untouched.
