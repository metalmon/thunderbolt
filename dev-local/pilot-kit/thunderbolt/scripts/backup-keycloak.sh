#!/usr/bin/env bash
# Copy of Keycloak's database — the pilot's whole account list.
#
# Cold copy, with the server stopped. That is not caution, it is the only complete
# one: the accounts live in an embedded H2 file, and Keycloak's own realm export
# (admin console, admin API) deliberately omits credentials, so an export cannot
# restore a login. Keycloak is down while the archive is written — seconds.
#
# The helper container is postgres:18-alpine because the kit already ships it and
# the perimeter is closed; the Keycloak image itself has no tar. Nothing is pulled.
#
# Usage: scripts/backup-keycloak.sh [target-dir]      (default: ./data/keycloak-backup)
#        Keeps the last 7 archives.
#
# Restore: see README.md, «Резервная копия Keycloak».
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

dest="${1:-data/keycloak-backup}"
helper=postgres:18-alpine

volume="$(docker volume ls --quiet --filter 'name=_keycloak_data$' | head -1)"
[[ -n "$volume" ]] || { echo "Keycloak has no database yet — nothing to back up." >&2; exit 1; }

mkdir -p "$dest"
archive="keycloak-$(date +%Y%m%d-%H%M%S).tgz"

# Only restart it if it was up, so running this on a stopped stand leaves it stopped.
was_running="$(docker compose ps --status running --services 2>/dev/null | grep -cx keycloak || true)"
[[ "$was_running" == "1" ]] && { echo "stopping keycloak ..."; docker compose stop keycloak >/dev/null; }

echo "archiving $volume -> $dest/$archive ..."
# `|| failed=1` rather than letting `set -e` out here: an abort would leave the stand
# down, which is worse than a missing archive. Restart first, report after.
failed=0
docker run --rm \
  -v "$volume:/kcdata:ro" \
  -v "$(pwd)/$dest:/backup" \
  "$helper" tar czf "/backup/$archive" -C /kcdata . || failed=1

[[ "$was_running" == "1" ]] && { echo "starting keycloak ..."; docker compose start keycloak >/dev/null; }
[[ "$failed" -eq 0 ]] || { rm -f -- "$dest/$archive"; echo "tar failed — no archive written." >&2; exit 1; }

# shellcheck disable=SC2012  # names are ours and carry no spaces
ls -1t "$dest"/keycloak-*.tgz 2>/dev/null | tail -n +8 | while read -r old; do rm -f -- "$old"; done

echo "done:"
ls -lh "$dest"/keycloak-*.tgz | tail -3
