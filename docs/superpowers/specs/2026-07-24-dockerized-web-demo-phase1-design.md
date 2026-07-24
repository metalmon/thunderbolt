# Dockerized Web Demo — Phase 1 Design

**Date:** 2026-07-24
**Status:** Approved for implementation planning
**Fork:** metalmon/thunderbolt (fork of thunderbird/thunderbolt, MPL-2.0)

## Goal

Run the **web version** of Thunderbolt as a container in the dev docker stack
(`powersync-service/docker-compose.yml`), alongside `backend`, `powersync`, and
`postgres`. The web app is served by nginx as a same-origin reverse proxy (like
"Thunderbolt PRO") and is reachable **externally through a tunnel**.

Primary entry is **anonymous demo access without registration**. Magic-link
registration (Thunderbolt's own emailOTP, `AUTH_MODE=consumer`) is present in the
backend and its verify redirect works via the public tunnel URL; real email
*delivery* is deferred to a later phase (see Roadmap).

## Roadmap context (this doc = Phase 1 only)

1. **Phase 1 — Dockerized web demo (this doc).** web service, same-origin nginx
   proxy for `/v1` and `/powersync`, consumer auth, anonymous demo, tunnel-ready.
2. **Phase 2 — OpenRouter proxy + preset free models.** Route LLM calls to
   OpenRouter; fork-owned model defaults replace upstream defaults in the UI.
3. **Phase 3 — Firecrawl Simple (fork on `E:`)** for web search + page fetch;
   backend search/scrape integration.
4. **Phase 4 — Email delivery.** Fork `forkSendEmail` seam → listmonk/SMTP.
   Blocked on a verified sending domain.

Phases 2–4 each get their own spec → plan → implementation cycle.

## Non-goals (Phase 1)

- No Keycloak / OIDC / SAML. `AUTH_MODE=consumer` only.
- No real transactional email (Resend/listmonk) — magic link uses the backend
  dev log fallback; the logged link is valid because `APP_URL` is the tunnel URL.
- No OpenRouter proxy, no free-model defaults, no Firecrawl. Those are Phases 2–4.
- No edits to any upstream source, upstream Dockerfiles, or the frontend auth gate.

## Architecture

```
                 Tunnel  ->  ${PUBLIC_URL}
                              │
                     ┌────────▼─────────┐   web container (nginx)
                     │  /v1/*       ->  backend:8000                │
                     │  /powersync/* -> powersync:8080 (SSE/ws)     │
                     │  /*          ->  SPA static (try_files)      │
                     └────────┬─────────┬───────────────┬──────────┘
                              │          │               │
                        ┌─────▼───┐ ┌────▼─────┐   (static bundle
                        │ backend │ │ powersync│    baked at build)
                        └────┬────┘ └────┬─────┘
                             │           │
                          ┌──▼───────────▼──┐
                          │    postgres      │
                          └──────────────────┘
```

**Networking decision — same-origin proxy (not direct-to-`:8000`).**
The web bundle is built with `VITE_THUNDERBOLT_CLOUD_URL=/v1`, so all API and
PowerSync traffic is same-origin under `${PUBLIC_URL}` and flows through the web
container's nginx. This is required for tunnel access: a remote browser cannot
reach `localhost:8000`/`localhost:8080` directly, so both must be proxied under
the single public origin. It also avoids cross-site cookie friction for the
credentialed auth/anonymous flows.

**PowerSync same-origin.** The backend returns `POWERSYNC_URL` to the browser in
`/v1/powersync/token`. It must be set to `${PUBLIC_URL}/powersync` so the browser
connects back through the tunnel. nginx proxies `/powersync/*` → `powersync:8080`
with streaming enabled (`proxy_buffering off`, HTTP/1.1, websocket `Upgrade`
headers) since PowerSync uses long-lived SSE/websocket sync streams.

## Fork-boundary compliance

| File | Type | Action |
|---|---|---|
| `dev-local/docker/web.Dockerfile` | **Additive (new)** | Build demo web bundle → nginx. Fork IP. |
| `dev-local/docker/web-nginx.conf.template` | **Additive (new)** | Same-origin proxy `/v1` + `/powersync` + SPA fallback. |
| `powersync-service/docker-compose.yml` | **Fork-owned edit** (already maintained on `fork/dev`) | Add `web` service; add backend env overrides. |
| `.env.example` / fork docs (optional) | **Additive** | Document `PUBLIC_URL`. |

**No upstream file is edited.** In particular, `deploy/docker/frontend.Dockerfile`,
`deploy/config/nginx.conf.template`, `backend/src/**`, and
`src/hooks/use-auth-gate.ts` are untouched. Anonymous + consumer works without any
frontend change because the shipped gate already allows anonymous when
`isAnonymousAuthEnabled() && !isSsoMode() && isWaitlistBypassed()` — all satisfied
by the build-time VITE flags below. These land on the `fork/dev` branch.

## Components

### 1. `dev-local/docker/web.Dockerfile` (new, additive)

Two-stage build modeled on the upstream `deploy/docker/frontend.Dockerfile`
pattern, but with **demo/consumer build args** instead of `VITE_AUTH_MODE=sso`:

- Stage 1 (`oven/bun`): `bun install --frozen-lockfile`, copy frontend source,
  then `bunx vite build`. Build-time env baked into the bundle:
  - `ARG VITE_THUNDERBOLT_CLOUD_URL="/v1"` → `ENV` (same-origin).
  - `ARG VITE_AUTH_ENABLE_ANONYMOUS="true"` → `ENV`.
  - `ARG VITE_BYPASS_WAITLIST="true"` → `ENV`.
  - `VITE_AUTH_MODE` **intentionally unset** (must not be `sso`, or the gate
    disables anonymous).
  - Do **not** copy the repo root `.env.production` into the build context — it
    points `VITE_THUNDERBOLT_CLOUD_URL` at `localhost:8000` (wrong for
    same-origin). Values come from the ARG/ENV above, matching the proven upstream
    Dockerfile pattern (Vite bakes `VITE_`-prefixed `process.env`).
- Stage 2 (`nginx:alpine`): copy the fork nginx template into
  `/etc/nginx/templates/default.conf.template` (rendered by nginx's `envsubst`
  entrypoint), copy `dist` to the web root. Env with defaults:
  `THUNDERBOLT_BACKEND_HOST=backend`, `THUNDERBOLT_BACKEND_PORT=8000`,
  `THUNDERBOLT_POWERSYNC_HOST=powersync`, `THUNDERBOLT_POWERSYNC_PORT=8080`.

### 2. `dev-local/docker/web-nginx.conf.template` (new, additive)

- `location ^~ /v1/ { proxy_pass http://$backend:$port; ... }` — mirror the
  upstream template's variable-host pattern for `/v1`.
- `location ^~ /powersync/ { proxy_pass http://$powersync:$psport/; ... }` —
  **trailing slash strips the `/powersync` prefix**; `proxy_http_version 1.1`,
  `proxy_set_header Upgrade`/`Connection` for websockets, `proxy_buffering off`
  and `proxy_read_timeout` long, for SSE sync streams.
- `location / { try_files $uri $uri/ /index.html; }` — SPA fallback.
- Reuse `security-headers.conf` inline or copy the upstream snippet (copy, not
  edit).

### 3. `powersync-service/docker-compose.yml` (fork-owned edit)

Add a `web` service:

```yaml
web:
  build:
    context: ../
    dockerfile: dev-local/docker/web.Dockerfile
  ports:
    - "${WEB_PORT:-3000}:80"
  depends_on:
    - backend
    - powersync
```

Add backend `environment` overrides (compose `environment` wins over the reused
`../backend/.env`). Parameterized by `${PUBLIC_URL}` (default
`http://localhost:3000`; set to the tunnel URL for external access):

```yaml
APP_URL: ${PUBLIC_URL:-http://localhost:3000}
BETTER_AUTH_URL: ${PUBLIC_URL:-http://localhost:3000}
TRUSTED_ORIGINS: ${PUBLIC_URL:-http://localhost:3000}
CORS_ORIGINS: ${PUBLIC_URL:-http://localhost:3000}
POWERSYNC_URL: ${PUBLIC_URL:-http://localhost:3000}/powersync
AUTH_ALLOW_ANONYMOUS: "true"   # belt-and-suspenders; already in backend/.env
```

## Auth behavior (Phase 1)

- **Anonymous demo (primary):** build flags satisfy the frontend gate; on load,
  an anonymous session is auto-created. No email, no registration. Works locally
  and through the tunnel.
- **Magic-link registration (secondary):** `AUTH_MODE=consumer` emailOTP is
  active. With no `RESEND_API_KEY`, the backend logs the magic link. Because
  `APP_URL=${PUBLIC_URL}`, the logged link targets the public tunnel origin and
  is clickable end-to-end. Automatic email *delivery* is Phase 4.

## Known limitations / handoff

- **Shared-backend origin:** this docker `backend` is now configured for the web
  origin (`BETTER_AUTH_URL=${PUBLIC_URL}`). If the native Tauri dev build must use
  the *same* backend, point it at `${PUBLIC_URL}` too, or run a separate backend
  for Tauri. Document in fork dev notes.
- **Email delivery** deferred to Phase 4 (needs verified domain).
- **PowerSync behind a subpath** (`/powersync`) must be validated — PowerSync
  clients append paths (`/sync/stream`, `/write-checkpoint`); confirm the
  prefix-stripping proxy_pass and streaming settings actually sustain a live sync.
  This is the highest-risk item to verify first.

## Testing / verification

1. `PUBLIC_URL=http://localhost:3000 docker compose -p bucher-thunderbolt up -d --build`
2. Open `http://localhost:3000` → app loads, an anonymous session is created.
3. Confirm PowerSync connects (network tab shows `/powersync/...` streaming 200,
   local writes replicate) — validates the same-origin PowerSync proxy.
4. Trigger email login → confirm the magic link is logged and points at
   `${PUBLIC_URL}`.
5. Repeat 2–4 with `PUBLIC_URL` set to the tunnel URL to confirm external access.

## Success criteria

- Web app served from the docker stack, no upstream files edited.
- Anonymous demo works locally and via tunnel.
- PowerSync sync is live over the same-origin `/powersync` proxy.
- Magic-link (log fallback) points at the public origin.
