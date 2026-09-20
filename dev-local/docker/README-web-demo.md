# Dockerized Web Demo (Phase 1)

Runs the Thunderbolt web app in the dev stack behind an nginx same-origin proxy.
Anonymous demo access works out of the box; magic-link registration uses the
backend dev log fallback (real email delivery is a later phase).

Built and deployed from the assembled `master` (upstream + fork i18n + zeroclaw +
dev). The source files below live on `fork/dev` and are assembled into `master`
by `dev-local/rebuild-master.ps1`.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:3000` | Public origin the demo is served from. Set to your tunnel URL for external access. Drives `APP_URL`, `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, `CORS_ORIGINS`, and `POWERSYNC_URL` for the compose backend. |
| `WEB_PORT` | `3000` | Host port the web container's nginx (`:80`) is published on. |
| `KEYCLOAK_PUBLIC_URL` | `http://localhost:8180` | Keycloak's **own** browser-facing origin (upstream OIDC recipe: `OIDC_ISSUER` = the keycloak service's `KC_HOSTNAME`). Local uses the published `:8180`; for remote access set it to Keycloak's own tunnel/domain (a **second** tunnel to `:8180`) — Keycloak keeps its own origin rather than riding the app tunnel. Only when `AUTH_MODE=oidc`. |
| `OPENROUTER_API_KEYS` | _(empty)_ | Comma-separated OpenRouter API keys for the free system models. The backend injects them server-side and rotates on rate-limit. Use keys from **different OpenRouter accounts** for the free-tier limit to actually multiply. Empty ⇒ the models return 503 on use. |
| `OPENROUTER_FREE_RPM` | `10` | Per-user requests/minute cap on the free models (in-memory throttle). |
| `HTTPS_PROXY` / `HTTP_PROXY` | _(unset)_ | Set in `secrets.env` when the host reaches the internet only through a per-process proxifier that does **not** hook the container (e.g. Proxifier with fake-DNS `127.x`, common in a closed RU perimeter). Point them at the upstream HTTP-CONNECT proxy directly (`http://USER:PASS@host:port`); the proxy resolves the domain remotely, bypassing the fake DNS. Bun `fetch` honours these. `NO_PROXY` (set in `docker-compose.yml`) keeps internal service traffic — postgres, keycloak, powersync, searxng, firecrawl — off the proxy. Leave unset if the container has normal egress. |

## Free models (OpenRouter)

Anonymous demo users chat with four free OpenRouter models (Nemotron 3 Super/Ultra,
Gemma 4 31B, Nemotron Nano 9B) via a backend-held key — no BYOK. Set
`OPENROUTER_API_KEYS` in `backend/.env` before starting the stack. Real users can
still add their own BYOK models. Per-user throttle is `OPENROUTER_FREE_RPM`.

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

### Keycloak OIDC through a tunnel

When `AUTH_MODE=oidc`, the login page is a **browser** redirect straight to
Keycloak's authorization endpoint — it does not go through `/v1`, so Keycloak
needs its own browser-reachable origin (upstream recipe: Keycloak is a separate
service with its own URL). Run a **second** tunnel to `localhost:8180` and set
`KEYCLOAK_PUBLIC_URL` to it; the backend's server-side token exchange still uses
the internal `keycloak:8080` (`KC_HOSTNAME_BACKCHANNEL_DYNAMIC`), so only the
frontchannel rides the second tunnel:

```bash
PUBLIC_URL=https://demo.example.tld \
KEYCLOAK_PUBLIC_URL=https://auth.example.tld \
  docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml up -d --build
```

Also add the app callback `${PUBLIC_URL}/v1/api/auth/sso/callback/sso` to the
`volt` client's `redirectUris` in `powersync-service/keycloak/realm.json` (the
committed realm allows `http://localhost:3000/*` for local dev).

## Web search + scrape (Phase 3)

The demo's web **search** runs on a self-hosted **SearXNG** (free JSON search, no
keys) and page **fetch/scrape** on the self-hosted **Firecrawl Simple** fork.
When `SEARXNG_URL` / `FIRECRAWL_URL` are set (in `secrets.env`), the backend
routes `/v1/search` and `fetch_content` there; unset ⇒ it falls back to Exa.

- **SearXNG** — `searxng/searxng` image + `searxng/settings.yml` (JSON output on).
- **Firecrawl** — 4 services (`firecrawl-api`, `-worker`, `-redis`, `-puppeteer`).
  Images are built locally from `E:\firecrawl-simple`:
  `docker compose -f E:/firecrawl-simple/docker-compose.yaml build`
  (tags `trieve/firecrawl` + `trieve/puppeteer-service-ts`). Phase 3a will
  publish these to `ghcr.io/metalmon` and swap the `image:` refs so no local
  build is needed.
- `FIRECRAWL_TOKEN` is any UUID — Firecrawl Simple only validates the format.

## Notes / limitations

- This backend is now configured for the web origin (`BETTER_AUTH_URL=PUBLIC_URL`).
  If the native Tauri build must use the same backend, point it at `PUBLIC_URL`
  too, or run a separate backend for Tauri.
- Email delivery (Resend/listmonk) is a later phase; magic link is log-only for now.
- If PowerSync will not honor the `/powersync` subpath, expose PowerSync on its
  own tunnel and set `POWERSYNC_URL` to it directly.
