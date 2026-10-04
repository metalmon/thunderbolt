#!/usr/bin/env bash
# Bring the pilot stack up. Usage: scripts/up.sh [--tls]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

[[ -f .env ]] || { echo "No .env found — run scripts/gen-secrets.sh <host> first." >&2; exit 1; }

required_images=(volt-web:pilot volt-backend:pilot quay.io/keycloak/keycloak:26.0 journeyapps/powersync-service:latest postgres:18-alpine)
have="$(docker images --format '{{.Repository}}:{{.Tag}}')"
missing=0
for img in "${required_images[@]}"; do
  echo "$have" | grep -qxF "$img" || { echo "MISSING image: $img — run scripts/load-images.sh first." >&2; missing=1; }
done
[[ "$missing" -eq 0 ]] || exit 1

profile_args=()
if [[ "${1:-}" == "--tls" ]]; then
  profile_args=(--profile tls)
  grep -qE '^VOLT_TLS_SERVER_NAME=.+' .env || { echo "VOLT_TLS_SERVER_NAME is not set in .env — required for --tls." >&2; exit 1; }
  [[ -f conf/certs/fullchain.pem && -f conf/certs/privkey.pem ]] || { echo "conf/certs/fullchain.pem + privkey.pem are missing — required for --tls (see README-pilot-tls.md)." >&2; exit 1; }
fi

docker compose -f docker-compose.yml "${profile_args[@]}" up -d

source .env 2>/dev/null || true
echo
echo "==> URLs"
echo "App:       ${PUBLIC_URL:-http://localhost:3000}"
echo "Keycloak:  ${KEYCLOAK_PUBLIC_URL:-http://localhost:8180} (admin console: /admin, user admin)"
echo
echo "==> OTP / magic-link (email is log-only in this kit)"
echo "docker compose logs backend | grep -i -E 'otp|magic'"
