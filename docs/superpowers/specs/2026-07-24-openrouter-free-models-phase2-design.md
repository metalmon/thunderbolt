# OpenRouter Free Models — Phase 2 Design

**Date:** 2026-07-24
**Status:** Approved for implementation planning
**Fork:** metalmon/thunderbolt (fork of thunderbird/thunderbolt, MPL-2.0)
**Depends on:** Phase 1 (dockerized web demo) — merged on `master`.

## Goal

Let **anonymous demo users** (who have no API key of their own) chat immediately
using **free OpenRouter models** served through a **server-side key** held by the
backend. Replace the upstream default model catalog with these free models. Add
per-user **throttling** and multi-key **rotation** to survive OpenRouter free-tier
rate limits under demo load.

The mechanism is a clone of the existing **Tinfoil managed-model pattern**: a
backend route injects the key server-side, and system models route through it with
a placeholder key.

## Roadmap context (this doc = Phase 2 only)

1. Phase 1 — Dockerized web demo. ✅ shipped.
2. **Phase 2 — OpenRouter proxy + preset free models (this doc).**
3. Phase 3 — Firecrawl Simple (fork on `E:`) search/scrape.
4. Phase 4 — Email delivery (listmonk/SMTP fork seam).

## The four preset models (all free, tools + reasoning)

Confirmed against the live OpenRouter catalog on 2026-07-24 (no free
DeepSeek/Llama/Qwen/Mistral currently exist; the NVIDIA Nemotron 3 line + Gemma 4
are the strong free options). Order = display order in the picker "Provided" group:

| Role | `model` (OpenRouter id) | ctx | notes |
|---|---|---|---|
| **Default** | `nvidia/nemotron-3-super-120b-a12b:free` | 262k | 120B / 12B-active MoE — strong + fast |
| Max | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1M | most capable free model |
| Google | `google/gemma-4-31b-it:free` | 262k | well-rounded |
| Fast | `nvidia/nemotron-nano-9b-v2:free` | 128k | snappy/light |

All get `provider:'openrouter'`, `isSystem:1`, `toolUsage:true`,
`startWithReasoning` as appropriate, `url:null`. **New `id`s** (the reconciler
freezes `provider`, so a new provider value must ship under a fresh id — see
`src/lib/reconcile-defaults.ts:512`).

## Architecture — Tinfoil-blueprint clone

```
 browser (system openrouter model, placeholder key + session token)
   │  baseURL = ${cloudUrl}/openrouter
   ▼
 backend  /v1/openrouter/*   (fork route, auth-guarded)
   │  • per-user throttle (token bucket)
   │  • pick key (round-robin) + inject Authorization: Bearer <key>
   │  • on 429/401/402 → cooldown that key, failover to next
   ▼
 https://openrouter.ai/api/v1/*
```

### Components

**Additive (new fork file, `fork/additive` branch):**
- `backend/src/fork/openrouter/routes.ts` — Elysia sub-app `prefix:'/openrouter'`,
  modeled on `backend/src/tinfoil/routes.ts`: `.onError(safeErrorHandler)`,
  `createAuthMacro(auth)`, `guard({auth:true})`, `.all('/*', …, {parse:'none'})`.
  Reads config **directly from `process.env`** (no `settings.ts` edit):
  - `OPENROUTER_API_KEYS` — comma-separated, 1..N keys.
  - `OPENROUTER_FREE_RPM` — per-user request/min cap (default 10).
  - target base `https://openrouter.ai/api/v1` (override `OPENROUTER_BASE_URL`).
  Injects `Authorization: Bearer <key>`; strips inbound `authorization/host/cookie/
  connection` (same header hygiene as tinfoil). Streams the body through
  (`decompress:false, duplex:'half'`).

**Invasive thin hooks (`fork/hooks` branch):**
- `backend/src/index.ts` — one `.use(createOpenrouterRoutes({ auth, rateLimit }))`
  line next to the existing tinfoil mount (~`:132`).
- `src/ai/fetch.ts` — add a branch in the `'openrouter'` case (~`:462`): when
  `modelConfig.isSystem`, route to `baseURL = ${cloudUrl}/openrouter` with a
  placeholder `apiKey:'thunderbolt-managed'` and a session-token-wrapped `fetch`
  (mirror the tinfoil system block at `:482-516`, minus the HPKE SecureClient —
  OpenRouter needs none). BYOK openrouter models keep today's behavior.

**Invasive data (`fork/hooks` branch):**
- `shared/defaults/models.ts` — replace `defaultModels` (`:154`) with the four
  models above; bump `defaultModelsVersion` 2 → 3 (`:170`).
- `src/defaults/model-profiles/` — add four profiles (one file, or grouped),
  register them in `index.ts` (`defaultModelProfiles` array + re-exports).
- `shared/defaults/models.test.ts` — update the colocated snapshot the version
  gate checks (per CLAUDE.md: any defaults change needs a matching version bump;
  the snapshot test enforces it).

**Branch mapping rationale:** the new route file is relicensable fork IP →
`fork/additive`. The seams + catalog data are invasive edits to upstream files →
`fork/hooks`. (Fully separating the catalog as relicensable IP would need a
defaults-seam; YAGNI now.)

## Key rotation

- `OPENROUTER_API_KEYS` parsed to an array at module load. Module-level
  round-robin index selects the next key per request.
- On an upstream `429` / `401` / `402` for the chosen key: put that key in a
  short **cooldown** (e.g. 60s) and **retry the request with the next** available
  key (bounded to one full pass). If every key is cooling down, return `429` with
  `Retry-After`.
- **Caveat:** OpenRouter free-tier limits are largely **per-account**; rotation
  only multiplies capacity if the keys belong to **different OpenRouter accounts**.
  Document this in the fork README.

## Throttle

- In-memory token bucket keyed by `userId` (the auth guard exposes the user;
  anonymous users have a stable id). Capacity/refill from `OPENROUTER_FREE_RPM`
  (default 10 req/min). On exhaustion return `429` + `Retry-After`.
- **Caveat:** in-memory state is per backend instance. Fine for the single-instance
  docker demo; a shared store (Redis) would be needed for horizontal scale — out
  of scope.

## Configuration

Backend env (add to `powersync-service/docker-compose.yml` backend `environment`
and document in `dev-local/docker/README-web-demo.md`):

```yaml
      OPENROUTER_API_KEYS: ${OPENROUTER_API_KEYS:-}   # comma-separated, from .env
      OPENROUTER_FREE_RPM: ${OPENROUTER_FREE_RPM:-10}
```

If `OPENROUTER_API_KEYS` is empty the route returns `503` ("OpenRouter not
configured"), exactly like tinfoil with no key — the app still loads, the models
just error on use.

## Fork boundary summary

1 new additive file (`backend/src/fork/openrouter/routes.ts`) + 2 thin hooks
(`index.ts`, `fetch.ts`) + data edits (`models.ts`, profiles, snapshot test). The
route reads env directly, so **no `settings.ts` edit**. All Phase-1 rules hold: no
edit outside the named files.

## Known limitations / handoff

- Rotation/throttle are in-memory (single-instance only).
- Free-tier per-account limits cap real throughput even with rotation.
- No key-level usage accounting/metrics (could be a later follow-up).

## Testing / verification

1. Unit: `backend/src/fork/openrouter/routes.test.ts` — key injection, round-robin
   selection, 429-failover to next key, all-cooling-down → 429, per-user throttle
   429, missing-keys → 503. (Use an injected `fetchFn`, mirroring tinfoil tests.)
2. `shared/defaults/models.test.ts` — snapshot passes with version 3 + four models.
3. Integration (docker demo, after `rebuild-master` + rebuild web/backend):
   - Set `OPENROUTER_API_KEYS` in `backend/.env`.
   - Open the demo as an anonymous user → the four models appear in the picker;
     the default (`nemotron-3-super-120b`) is selected.
   - Send a chat message → streamed response arrives (key injected server-side).
   - Exceed `OPENROUTER_FREE_RPM` quickly → `429` surfaced to the client.

## Success criteria

- Anonymous demo user chats with free OpenRouter models using the server key,
  no BYOK required.
- Upstream default catalog replaced by the four free models (version bumped 3,
  snapshot test green).
- Per-user throttle and multi-key rotation active in the fork route.
- No upstream file edited outside `index.ts`, `fetch.ts`, `models.ts`,
  `model-profiles/*`, and the snapshot test.
