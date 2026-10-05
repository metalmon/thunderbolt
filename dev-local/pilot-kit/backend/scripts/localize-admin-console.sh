#!/usr/bin/env bash
# Make Keycloak's ADMIN console Russian and branded.
#
# The realm import only carries the `volt` realm, and the console an operator logs
# into belongs to `master` — which is why that page stays English with Keycloak's
# own wordmark while the user-facing sign-in is already «Вольт» in Russian. Master
# can only be changed through the admin API, so it is a step of its own.
#
# Re-running is safe: it sets the same three fields.
#
# Usage: scripts/localize-admin-console.sh [admin-password]
#        (reads KEYCLOAK_ADMIN_PASSWORD from .env when omitted)
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

password="${1:-}"
if [[ -z "$password" && -f .env ]]; then
  password="$(sed -n 's/^KEYCLOAK_ADMIN_PASSWORD=//p' .env | head -1)"
fi
[[ -n "$password" ]] || { echo "no admin password: pass it as an argument or set KEYCLOAK_ADMIN_PASSWORD in .env" >&2; exit 1; }

# Inside the compose network, so this works with the TLS profile too and needs no
# certificate trust on the host.
kc() { docker compose exec -T keycloak "$@"; }

echo "signing in to the admin API ..."
# Handed over on stdin and read by a shell inside the container, so it never appears
# in an argument of the docker CLI — where every local user could read it out of `ps`
# for as long as the call runs. kcadm itself refuses a non-TTY password prompt
# ("Console is not active, but password is required"), hence the inner `read`. Its own
# argv is inside the container that already holds this password in its environment, so
# that hop adds nothing.
printf '%s\n' "$password" | kc sh -c '
  read -r p
  exec /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080 --realm master --user admin --password "$p"' >/dev/null

echo "master realm -> Russian, volt theme ..."
kc /opt/keycloak/bin/kcadm.sh update realms/master \
  -s internationalizationEnabled=true \
  -s defaultLocale=ru \
  -s 'supportedLocales=["ru","en"]' \
  -s loginTheme=volt >/dev/null

# kcadm leaves an admin refresh token behind in the container. Nothing needs it after this.
kc rm -f /opt/keycloak/.keycloak/kcadm.config >/dev/null 2>&1 || true

echo "done — reopen the console; the browser caches the theme and the locale."
