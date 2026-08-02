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
| `OPENROUTER_API_KEYS` | _(empty)_ | Comma-separated OpenRouter API keys for the free system models. The backend injects them server-side and rotates on rate-limit. Use keys from **different OpenRouter accounts** for the free-tier limit to actually multiply. Empty ⇒ the models return 503 on use. |
| `OPENROUTER_FREE_RPM` | `10` | Per-user requests/minute cap on the free models (in-memory throttle). |

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
