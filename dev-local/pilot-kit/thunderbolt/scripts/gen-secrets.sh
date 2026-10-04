#!/usr/bin/env bash
# Generate ./.env from conf/.env.example with random secrets, pointed at the
# given public hostname/IP. Re-run is safe: it overwrites .env, but will not
# touch an existing one unless -f is given.
#
# Usage: scripts/gen-secrets.sh <public-hostname-or-ip> [--tls] [--voltd] [-f]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

host="${1:-}"
[[ -n "$host" ]] || { echo "Usage: $0 <public-hostname-or-ip> [--tls] [--voltd] [-f]" >&2; exit 1; }
shift || true
use_tls=0
use_voltd=0
force=0
for arg in "$@"; do
  case "$arg" in
    --tls) use_tls=1 ;;
    --voltd) use_voltd=1 ;;
    -f) force=1 ;;
  esac
done

if [[ -f .env && "$force" -ne 1 ]]; then
  echo ".env already exists — pass -f to overwrite." >&2
  exit 1
fi

# voltd needs the backend reachable over https: the issuer it fetches discovery
# and JWKS from is rejected by the backend itself unless it is https or loopback
# (RFC 8252 rule in isValidVoltdIssuer), and a rejected issuer silently turns the
# whole feature off rather than failing loudly. Refuse the combination here.
if [[ "$use_voltd" -eq 1 && "$use_tls" -ne 1 ]]; then
  echo "--voltd requires --tls: a non-loopback http:// issuer is refused and the" >&2
  echo "feature would start up silently disabled." >&2
  exit 1
fi

rand_b64() { openssl rand -base64 "$1" | tr -d '\n'; }

better_auth_secret="$(rand_b64 32)"
powersync_secret="$(rand_b64 32)"
postgres_password="$(rand_b64 24)"
keycloak_admin_password="$(rand_b64 18)"
# The realm's client secret is generated too, and written into BOTH .env and
# realm.json below. The committed placeholder is the same on every copy of the
# kit, and "remember to change it by hand in two files" is not a control.
oidc_client_secret="$(openssl rand -hex 16)"

if [[ "$use_tls" -eq 1 ]]; then
  public_url="https://${host}"
  keycloak_public_url="https://${host}:8444"
else
  public_url="http://${host}:3000"
  keycloak_public_url="http://${host}:8180"
fi

cp conf/.env.example .env
# Portable in-place sed (no -i suffix quirk juggling): write to temp, then move.
sed -e "s|^PUBLIC_URL=.*|PUBLIC_URL=${public_url}|" \
    -e "s|^KEYCLOAK_PUBLIC_URL=.*|KEYCLOAK_PUBLIC_URL=${keycloak_public_url}|" \
    -e "s|^VOLT_TLS_SERVER_NAME=.*|VOLT_TLS_SERVER_NAME=${host}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${postgres_password}|" \
    -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=${better_auth_secret}|" \
    -e "s|^POWERSYNC_JWT_SECRET=.*|POWERSYNC_JWT_SECRET=${powersync_secret}|" \
    -e "s|^KEYCLOAK_ADMIN_PASSWORD=.*|KEYCLOAK_ADMIN_PASSWORD=${keycloak_admin_password}|" \
    -e "s|^OIDC_CLIENT_SECRET=.*|OIDC_CLIENT_SECRET=${oidc_client_secret}|" \
    .env > .env.tmp
mv .env.tmp .env

# Keep conf/powersync/config.yaml's HS256 key in sync with POWERSYNC_JWT_SECRET
# (client_auth.jwks.keys[0].k = base64 of the raw secret).
powersync_secret_b64="$(printf '%s' "$powersync_secret" | base64 | tr -d '\n')"
sed -e "s|^\( *k: \).*|\1${powersync_secret_b64}|" \
    conf/powersync/config.yaml > conf/powersync/config.yaml.tmp
mv conf/powersync/config.yaml.tmp conf/powersync/config.yaml

# Point the realm's client at the SAME origin as PUBLIC_URL. Keycloak matches
# redirect_uri exactly, so a realm left on http://localhost:3000 refuses the SSO
# callback with "Invalid parameter: redirect_uri" on every host that is not the
# operator's own laptop — i.e. every real pilot. webOrigins rides along for CORS.
#
# Matched on the URL's own shape rather than the literal localhost origin, so a
# second run with a different host name still repoints it.
sed -e "s|\"https\?://[^\"]*/v1/api/auth/sso/callback/sso\"|\"${public_url}/v1/api/auth/sso/callback/sso\"|g" \
    -e "s|\"https\?://[^\"]*/\*\"|\"${public_url}/*\"|g" \
    -e "s|\"https\?://[^\"/]*\"|\"${public_url}\"|g" \
    -e "s|\"secret\": \"[^\"]*\"|\"secret\": \"${oidc_client_secret}\"|" \
    conf/keycloak/realm.json > conf/keycloak/realm.json.tmp
mv conf/keycloak/realm.json.tmp conf/keycloak/realm.json

if [ "$use_tls" -ne 1 ]; then
  # No terminator in front, so the SPA and Keycloak have to be reachable on the
  # LAN directly. Every other published port stays on loopback either way. The
  # template's line is rewritten rather than a second one appended: compose would
  # honour the last, but a file a human reads must not state it twice.
  sed -e "s|^VOLT_BIND_ADDR=.*|VOLT_BIND_ADDR=0.0.0.0|" .env > .env.tmp
  mv .env.tmp .env
  echo "NOTE: no --tls, so web and Keycloak are published on 0.0.0.0 in plain HTTP."
fi

echo "Wrote .env (PUBLIC_URL=${public_url}, KEYCLOAK_PUBLIC_URL=${keycloak_public_url})"
echo "Synced conf/powersync/config.yaml's HS256 key to the new POWERSYNC_JWT_SECRET."
echo "Repointed conf/keycloak/realm.json's redirect URIs at ${public_url} and gave"
echo "  the volt-app client a fresh secret (same value in .env and realm.json)."
echo "AI provider key was left as-is — see .env comments."
echo "The realm ships with NO users: create them in the Keycloak admin console at"
echo "  ${keycloak_public_url}/admin (user 'admin', password in .env), then put each"
echo "  one in volt-admins / volt-avk / volt-kb as needed."

if [[ "$use_voltd" -eq 1 ]]; then
  # voltd agent auto-discovery: merge the overlay and name the gateway. The
  # backend reads these from .env (its env_file), so they must not also appear in
  # the compose `environment:` block — see docker-compose.voltd.yml.
  cat >> .env <<EOF

# ============================================================
# voltd agent auto-discovery (added by gen-secrets.sh --voltd)
# ============================================================

# Merge docker-compose.voltd.yml on top of docker-compose.yml for every
# \`docker compose\` call. COMPOSE_PATH_SEPARATOR is required: compose defaults it
# to ';' on Windows, which would read the ':' below as part of a file name.
COMPOSE_FILE=docker-compose.yml:docker-compose.voltd.yml
COMPOSE_PATH_SEPARATOR=:

# voltd's public ACP endpoint. Unset/empty = feature off (no agents published,
# no relay route). Must be wss:// unless it is loopback.
VOLTD_URL=wss://${host}:8443/acp

# The \`iss\` our access tokens carry and the base voltd fetches
# /.well-known/openid-configuration + /voltd/jwks from. MUST equal
# \`issuer\` in voltd's [oidc.volt] block, including the /v1.
VOLTD_ISSUER=${public_url}/v1

# Dotted path to the group claim Keycloak emits (the realm's Group Membership
# mapper writes \`groups\`). Must equal \`claim_path\` in [oidc.volt].
VOLTD_GROUPS_CLAIM=groups
EOF

  # The backend's own TLS hop to voltd is made by Bun, whose root store knows
  # nothing about the pilot CA. Without this the roster call fails with "unable
  # to verify the first certificate" and no agent is ever published.
  sed -e "s|^VOLT_BACKEND_EXTRA_CA=.*|VOLT_BACKEND_EXTRA_CA=/etc/volt/certs/ca.crt.pem|" \
      .env > .env.tmp
  mv .env.tmp .env

  echo "voltd enabled: VOLTD_URL=wss://${host}:8443/acp, VOLTD_ISSUER=${public_url}/v1"
  echo "  1) scripts/gen-voltd-keys.sh   (ES256 keypair the tokens are signed with)"
  echo "  2) copy certs/out/ca.crt.pem into conf/certs/  (Bun must trust voltd's leaf)"
  echo "  3) on the voltd side: uncomment [oidc.volt], issuer = ${public_url}/v1"
fi

if [[ "$use_tls" -eq 1 ]]; then
  echo "TLS profile requested: put fullchain.pem + privkey.pem in conf/certs/ before 'up.sh --tls'."
fi
