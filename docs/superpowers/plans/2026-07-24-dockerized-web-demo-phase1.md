# Dockerized Web Demo — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the Thunderbolt web app as a container in the dev docker stack (`powersync-service/docker-compose.yml`), behind an nginx same-origin reverse proxy for `/v1` and `/powersync`, with anonymous demo access and tunnel-readiness via `${PUBLIC_URL}`.

**Architecture:** A new fork-owned web container builds the frontend static bundle (consumer/anonymous build flags) and serves it through nginx, which reverse-proxies `/v1/*` → `backend:8000` and `/powersync/*` → `powersync:8080` under one origin. The dev compose gains a `web` service and backend env overrides parameterized by `${PUBLIC_URL}`. No upstream file is edited.

**Tech Stack:** Docker Compose, `oven/bun` (Vite build), `nginx:alpine` (envsubst templates), PowerSync (HTTP streaming), Better Auth (consumer emailOTP + anonymous plugin).

## Global Constraints

- **License boundary:** New files are additive fork IP under `dev-local/**` (currently MPL-headered like the rest of the fork). Do NOT edit any upstream file: `deploy/docker/frontend.Dockerfile`, `deploy/config/nginx.conf.template`, `deploy/config/security-headers.conf`, `backend/src/**`, `src/**` are read/copy-only. `powersync-service/docker-compose.yml` is already fork-maintained on `fork/dev` — editing it is in-bounds.
- **Branch:** all changes land on `fork/dev`.
- **PowerSync transport is HTTP streaming, not WebSocket** (`src/db/powersync/database.ts:209`). The `/powersync` proxy needs `proxy_buffering off` + HTTP/1.1 keepalive; NO websocket `Upgrade` headers.
- **VITE flags for anonymous demo** (baked at build): `VITE_AUTH_ENABLE_ANONYMOUS=true`, `VITE_BYPASS_WAITLIST=true`, `VITE_THUNDERBOLT_CLOUD_URL=/v1`, and `VITE_AUTH_MODE` MUST be unset (any `sso` value disables the anonymous gate at `src/components/auth-gate/use-auth-gate.ts:40`).
- **Commits:** use the project `/thunderpush` skill (never raw `git add/commit/push`, per CLAUDE.md).
- **Windows env:** `git config core.autocrlf false` already set per fork rules; new files use LF.

---

### Task 1: Fork web container (nginx config + Dockerfile)

Build a standalone web image that compiles the demo bundle and serves it via nginx with same-origin `/v1` and `/powersync` proxies.

**Files:**
- Create: `dev-local/docker/web-nginx.conf.template`
- Create: `dev-local/docker/web.Dockerfile`

**Interfaces:**
- Produces: a buildable image (tag `thunderbolt-web:dev`) that serves the SPA on port 80 and defines envsubst vars `THUNDERBOLT_BACKEND_HOST` (default `backend`), `THUNDERBOLT_BACKEND_PORT` (default `8000`), `THUNDERBOLT_POWERSYNC_HOST` (default `powersync`), `THUNDERBOLT_POWERSYNC_PORT` (default `8080`). Task 2 consumes this image via `build:` in compose.

- [ ] **Step 1: Create the nginx template**

Create `dev-local/docker/web-nginx.conf.template`:

```nginx
# Fork web container nginx config (additive fork IP).
# Same-origin reverse proxy so a single tunnel origin (${PUBLIC_URL}) serves the
# SPA, the backend API, and the PowerSync sync stream. Rendered by the nginx
# image's envsubst entrypoint over /etc/nginx/templates/*.template.
#
# THUNDERBOLT_-prefixed var names dodge Kubernetes' auto-injected <SERVICE>_PORT
# env vars (same rationale as deploy/config/nginx.conf.template upstream).

server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # Backend API. Variable host forces runtime DNS resolution (nginx won't crash
    # if backend is not up yet). No URI on proxy_pass: with a variable host nginx
    # passes the original request URI through unchanged.
    location ^~ /v1/ {
        include /etc/nginx/snippets/security-headers.conf;
        resolver 127.0.0.11 valid=10s;
        set $backend "${THUNDERBOLT_BACKEND_HOST}";
        # nosemgrep: generic.nginx.security.dynamic-proxy-host.dynamic-proxy-host
        # nosemgrep: generic.nginx.security.missing-internal.missing-internal
        proxy_pass http://$backend:${THUNDERBOLT_BACKEND_PORT};
        proxy_set_header Host $proxy_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        # Empty Connection = HTTP/1.1 keep-alive; backend uses SSE, not WebSocket.
        proxy_set_header Connection "";
    }

    # PowerSync sync stream. Strip the /powersync prefix, then proxy to the
    # service root. HTTP streaming (SyncStreamConnectionMethod.HTTP) requires
    # proxy_buffering off and long read timeouts; NO websocket Upgrade headers.
    location ^~ /powersync/ {
        include /etc/nginx/snippets/security-headers.conf;
        resolver 127.0.0.11 valid=10s;
        set $psbackend "${THUNDERBOLT_POWERSYNC_HOST}";
        rewrite ^/powersync/(.*)$ /$1 break;
        # nosemgrep: generic.nginx.security.dynamic-proxy-host.dynamic-proxy-host
        # nosemgrep: generic.nginx.security.missing-internal.missing-internal
        proxy_pass http://$psbackend:${THUNDERBOLT_POWERSYNC_PORT};
        proxy_set_header Host $proxy_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Cache hashed static assets aggressively.
    location /assets/ {
        include /etc/nginx/snippets/security-headers.conf;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Source maps are uploaded to error tracking, not served publicly.
    location ~* \.map$ {
        return 404;
    }

    # SPA fallback.
    location / {
        include /etc/nginx/snippets/security-headers.conf;
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 2: Create the fork Dockerfile**

Create `dev-local/docker/web.Dockerfile`:

```dockerfile
# Fork web container (additive fork IP). Builds the Thunderbolt frontend with
# demo/consumer/anonymous flags and serves it via nginx same-origin proxy.
# Deliberately NOT deploy/docker/frontend.Dockerfile (upstream, SSO-baked) — we
# do not edit upstream. Copies upstream nginx security-headers snippet (read-only).

# Stage 1: Build the static bundle
FROM oven/bun:latest AS build
WORKDIR /app

# Deps first for layer caching
COPY package.json bun.lock ./
COPY shared ./shared
RUN bun install --frozen-lockfile

# Frontend source
COPY src ./src
COPY public ./public
COPY index.html ./
COPY vite.config.ts tsconfig.json tsconfig.node.json ./
COPY components.json ./
COPY .storybook ./.storybook

# Demo build config baked into the bundle. VITE_AUTH_MODE is intentionally
# omitted (must not be "sso"). Do NOT copy the repo .env.production — it points
# VITE_THUNDERBOLT_CLOUD_URL at localhost:8000, wrong for same-origin.
ARG VITE_THUNDERBOLT_CLOUD_URL="/v1"
ARG VITE_AUTH_ENABLE_ANONYMOUS="true"
ARG VITE_BYPASS_WAITLIST="true"
ENV VITE_THUNDERBOLT_CLOUD_URL=$VITE_THUNDERBOLT_CLOUD_URL
ENV VITE_AUTH_ENABLE_ANONYMOUS=$VITE_AUTH_ENABLE_ANONYMOUS
ENV VITE_BYPASS_WAITLIST=$VITE_BYPASS_WAITLIST

RUN bunx vite build && find dist -name '*.map' -delete

# Stage 2: Serve with nginx
FROM nginx:alpine

# Upstream defaults; override in compose/k8s. THUNDERBOLT_-prefixed to dodge
# Kubernetes <SERVICE>_PORT injection.
ENV THUNDERBOLT_BACKEND_HOST=backend
ENV THUNDERBOLT_BACKEND_PORT=8000
ENV THUNDERBOLT_POWERSYNC_HOST=powersync
ENV THUNDERBOLT_POWERSYNC_PORT=8080

COPY dev-local/docker/web-nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/config/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 3: Build the image (this is the test)**

Run from repo root:
```bash
docker build -f dev-local/docker/web.Dockerfile -t thunderbolt-web:dev .
```
Expected: build completes; final line `naming to docker.io/library/thunderbolt-web:dev`. If `bun install --frozen-lockfile` fails, the lockfile is stale — stop and report, do not switch to a non-frozen install.

- [ ] **Step 4: Smoke-test the container standalone**

```bash
docker run -d --name tb-web-smoke -p 3000:80 thunderbolt-web:dev
sleep 2
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
docker exec tb-web-smoke nginx -t
docker rm -f tb-web-smoke
```
Expected: `curl` prints `200`; `nginx -t` prints `syntax is ok` / `test is successful`. (Proxies to `/v1` and `/powersync` will 502 standalone — that is fine here; validated in Task 2.)

- [ ] **Step 5: Commit**

Invoke `/thunderpush` with message:
`feat(dev): fork web container — nginx same-origin proxy for /v1 and /powersync`

---

### Task 2: Compose integration + backend env overrides

Add the `web` service to the dev stack and configure the backend for the same-origin/public origin so anonymous demo and PowerSync sync work end-to-end locally.

**Files:**
- Modify: `powersync-service/docker-compose.yml`

**Interfaces:**
- Consumes: `thunderbolt-web:dev` build from Task 1 (`dev-local/docker/web.Dockerfile`).
- Produces: a running stack where `${PUBLIC_URL}` (default `http://localhost:3000`) serves SPA + `/v1` + `/powersync`. Backend env keys set: `APP_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `CORS_ORIGINS` = `${PUBLIC_URL}`; `POWERSYNC_URL` = `${PUBLIC_URL}/powersync`; `AUTH_ALLOW_ANONYMOUS=true`.

- [ ] **Step 1: Add the `web` service**

In `powersync-service/docker-compose.yml`, add under `services:` (sibling to `backend`, `powersync`, `postgres`):

```yaml
  web:
    restart: unless-stopped
    build:
      context: ../
      dockerfile: dev-local/docker/web.Dockerfile
    depends_on:
      - backend
      - powersync
    ports:
      - "${WEB_PORT:-3000}:80"
```

- [ ] **Step 2: Add backend env overrides**

In the same file, extend the existing `backend.environment` block (which currently sets `DATABASE_URL`). Compose `environment` overrides the reused `../backend/.env`. Add:

```yaml
      APP_URL: ${PUBLIC_URL:-http://localhost:3000}
      BETTER_AUTH_URL: ${PUBLIC_URL:-http://localhost:3000}
      TRUSTED_ORIGINS: ${PUBLIC_URL:-http://localhost:3000}
      CORS_ORIGINS: ${PUBLIC_URL:-http://localhost:3000}
      POWERSYNC_URL: ${PUBLIC_URL:-http://localhost:3000}/powersync
      AUTH_ALLOW_ANONYMOUS: "true"
```

- [ ] **Step 3: Bring up the stack**

```bash
PUBLIC_URL=http://localhost:3000 docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml up -d --build
docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml ps
```
Expected: `web`, `backend`, `powersync`, `postgres` all `Up` (postgres `healthy`).

- [ ] **Step 4: Verify same-origin routing + anonymous session**

```bash
# SPA
curl -sS -o /dev/null -w "spa:%{http_code}\n" http://localhost:3000/
# /v1 proxied to backend (health/root — expect a non-502; 200/401/404 all prove the proxy works)
curl -sS -o /dev/null -w "v1:%{http_code}\n" http://localhost:3000/v1/
# anonymous sign-in through the proxy
curl -sS -o /dev/null -w "anon:%{http_code}\n" -X POST http://localhost:3000/v1/api/auth/sign-in/anonymous -H "content-type: application/json" -d '{}'
```
Expected: `spa:200`; `v1:` any code that is NOT `502`/`504` (proves nginx reached the backend); `anon:200`. If `v1:502`, the backend host/port envsubst or `depends_on` is wrong — debug before proceeding.

- [ ] **Step 5: Verify PowerSync same-origin stream (highest-risk item)**

Open `http://localhost:3000` in a browser. In DevTools → Network, filter `powersync`. Confirm a request to `http://localhost:3000/powersync/...` (e.g. `/powersync/sync/stream`) returns `200` and stays open (streaming), and that the app reaches a synced state (create a chat/message; it persists).

**If the PowerSync request instead targets `http://localhost:3000/sync/stream` (no `/powersync` prefix)** — the SDK is dropping the base subpath. Fallback: revert `POWERSYNC_URL` to a directly-reachable origin. Locally set `POWERSYNC_URL: http://localhost:${POWERSYNC_PORT:-8080}` and expose PowerSync on its own tunnel/subdomain in production; record this in the Task 3 docs and the spec's limitations. Do not force the subpath if the SDK won't honor it.

- [ ] **Step 6: Commit**

Invoke `/thunderpush` with message:
`feat(dev): add web service + public-origin backend env to dev compose`

---

### Task 3: PUBLIC_URL / tunnel readiness + fork docs

Document the new demo workflow and confirm the stack works when `${PUBLIC_URL}` is an external URL.

**Files:**
- Create: `dev-local/docker/README-web-demo.md`
- Modify: `.env.example` (append `PUBLIC_URL` / `WEB_PORT` documentation — this is a fork-maintained env doc, additive lines only)

**Interfaces:**
- Consumes: the running stack from Task 2.
- Produces: operator docs for launching the tunneled demo.

- [ ] **Step 1: Write the demo README**

Create `dev-local/docker/README-web-demo.md`:

````markdown
# Dockerized Web Demo (Phase 1)

Runs the Thunderbolt web app in the dev stack behind an nginx same-origin proxy.
Anonymous demo access works out of the box; magic-link registration uses the
backend dev log fallback (real email delivery is a later phase).

## Local

```bash
PUBLIC_URL=http://localhost:3000 \
  docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml up -d --build
```
Open http://localhost:3000 — an anonymous session is created automatically.

## Through a tunnel

Point `PUBLIC_URL` at the public tunnel URL, then start the tunnel to
`localhost:${WEB_PORT:-3000}`:

```bash
PUBLIC_URL=https://demo.example.tld \
  docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml up -d --build
```
`APP_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `CORS_ORIGINS`, and
`POWERSYNC_URL` all derive from `PUBLIC_URL`, so `/v1` and `/powersync` are
same-origin and reachable through the single tunnel. Magic-link URLs logged by
the backend point at `PUBLIC_URL` and are clickable end-to-end.

## Notes / limitations

- This backend is now configured for the web origin (`BETTER_AUTH_URL=PUBLIC_URL`).
  If the native Tauri build must use the same backend, point it at `PUBLIC_URL`
  too, or run a separate backend for Tauri.
- Email delivery (Resend/listmonk) is Phase 4; magic link is log-only for now.
- If PowerSync will not honor the `/powersync` subpath (see compose Task 2
  Step 5), expose PowerSync on its own tunnel and set `POWERSYNC_URL` to it.
````

- [ ] **Step 2: Document env vars in `.env.example`**

Append to `.env.example` (additive lines only; do not alter existing lines):

```bash
# --- Dockerized web demo (dev-local/docker) ---
# Public origin the web demo is served from. Local default is http://localhost:3000;
# set to your tunnel URL for external access. Drives APP_URL/BETTER_AUTH_URL/
# TRUSTED_ORIGINS/CORS_ORIGINS/POWERSYNC_URL for the compose backend.
# PUBLIC_URL="https://demo.example.tld"
# Host port the web container's nginx (:80) is published on.
# WEB_PORT="3000"
```

- [ ] **Step 3: Verify external-origin config (no code, config smoke)**

Re-up with a non-localhost `PUBLIC_URL` (use a LAN IP or the real tunnel URL if available) and confirm the backend echoes it:
```bash
PUBLIC_URL=http://<lan-ip-or-tunnel> docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml up -d
# The powersync token response must contain the PUBLIC_URL-based powersync endpoint:
curl -sS http://localhost:3000/v1/... # (an authenticated powersync-token call; or inspect in browser DevTools)
```
Expected: `POWERSYNC_URL` in the token response is `<PUBLIC_URL>/powersync`, and loading the app from the external origin creates an anonymous session with live sync. If you only have localhost, note that external verification is deferred to the first real tunnel run.

- [ ] **Step 4: Commit**

Invoke `/thunderpush` with message:
`docs(dev): document dockerized web demo + PUBLIC_URL/WEB_PORT`

---

## Self-Review

**Spec coverage:**
- Same-origin proxy `/v1` + `/powersync` → Task 1 nginx template. ✓
- Fork Dockerfile with demo VITE flags, no upstream edit → Task 1. ✓
- `web` service + backend env overrides + `${PUBLIC_URL}` → Task 2. ✓
- Anonymous demo (no frontend gate edit) → Task 2 Step 4 (build flags satisfy the gate). ✓
- PowerSync same-origin + HTTP-streaming settings + subpath risk & fallback → Task 1 template, Task 2 Step 5. ✓
- Magic-link log fallback pointing at `PUBLIC_URL` → Task 3 README. ✓
- Tunnel readiness + docs → Task 3. ✓
- No upstream files edited → Global Constraints; only `powersync-service/docker-compose.yml` (fork-owned) and `.env.example` (additive lines) modified. ✓

**Placeholder scan:** No TBD/TODO; all file contents and commands are concrete. The `<lan-ip-or-tunnel>` and the authenticated token-call URL in Task 3 Step 3 are intentionally environment-specific and marked as such.

**Type/name consistency:** envsubst var names (`THUNDERBOLT_BACKEND_HOST/PORT`, `THUNDERBOLT_POWERSYNC_HOST/PORT`) match between the nginx template (Task 1 Step 1) and the Dockerfile `ENV` defaults (Task 1 Step 2). `${PUBLIC_URL}`/`${WEB_PORT}` consistent across Tasks 2 and 3. Image/service name `web` consistent.
