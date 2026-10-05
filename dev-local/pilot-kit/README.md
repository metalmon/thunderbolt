# Our half of the Volt pilot kit

The closed-perimeter pilot ships as a flash drive: `pilot-kit/` with one folder
per component (`certs/`, `volt/` = voltd, `glossa/`, `volt-admin/`, `handy/`) and
`backend/` — ours. That folder lives in their staging tree; this
directory is where its contents are **authored**.

Everything here is copied into the kit by `dev-local/pilot-kit-sync.ps1`, never
edited in place:

```powershell
pwsh dev-local/pilot-kit-sync.ps1 -KitPath <kit>\backend -WhatIf   # see what changes
pwsh dev-local/pilot-kit-sync.ps1 -KitPath <kit>\backend
```

Only files that differ are written; nothing in the kit is deleted, and
`images/`, `conf/certs/`, `conf/voltd-keys/`, `.env` and `data/` are never
touched.

## What is here and why

| Path | Why it is ours |
|---|---|
| `backend/conf/keycloak/realm.json` | pilot groups `volt-admins`/`volt-avk`/`volt-kb`, the Group Membership mapper that emits `groups`, RU locale, «Вольт» as the realm display name, and **no users at all** |
| `backend/conf/nginx/web-nginx.conf.template` | byte-identical to `dev-local/docker/web-nginx.conf.template`; carries the WebSocket locations for `/v1/voltd/ws` and `/v1/proxy/ws` |
| `backend/docker-compose.voltd.yml` | voltd overlay: key paths, group claim, read-only `conf/voltd-keys` mount |
| `backend/scripts/gen-secrets.{sh,ps1}` | `--voltd` / `-Voltd`, the realm's redirect-URI repointing, a generated client secret written to `.env` and `realm.json` together, and the `-Host` → `-PublicHost` fix |

One edit is still owed to the kit's own `backend/README.md`, which this repo
does not carry: it documents a `demo`/`demo` login that the realm no longer
creates. Replace that table with "users are created in the Keycloak admin console"
when next touching the kit.
| `backend/scripts/gen-voltd-keys.{sh,ps1}` | ES256 keypair via Bun inside the backend image (no openssl on the host) |
| `backend/scripts/install-hosts.{sh,ps1}` | client-machine name resolution; the desktop build's backend address is baked in, so the name must resolve locally |
| `backend/README-voltd.md` | operator steps + the `[oidc.volt]` fields that must match |
| `backend/README-pilot-dns.md` | which names must resolve where, and how |

The rest of the kit's `backend/` folder (its `README.md`, `docker-compose.yml`,
`conf/.env.example`, `conf/powersync/`, `conf/postgres/`, the other `scripts/*`)
is unchanged from what already shipped and is not duplicated here.

## Images

`backend/images/*.tar.gz` are `docker save`d from the dev stack's own tags and
are NOT in this repo (≈850 MB). Refresh them whenever `master` moves:

```powershell
docker compose -p bucher-thunderbolt -f powersync-service/docker-compose.yml build backend web
docker tag bucher-thunderbolt-backend:latest volt-backend:pilot
docker tag bucher-thunderbolt-web:latest     volt-web:pilot
docker save volt-backend:pilot | gzip > <kit>\backend\images\volt-backend.tar.gz
docker save volt-web:pilot     | gzip > <kit>\backend\images\volt-web.tar.gz
```

Build from `master`, not from a fork branch — a fork branch's working tree is
missing whatever the other branches carry (a backend image built off `fork/dev`
has no `src/fork/voltd/**` at all, and the only symptom is a 404 on the
discovery routes).
