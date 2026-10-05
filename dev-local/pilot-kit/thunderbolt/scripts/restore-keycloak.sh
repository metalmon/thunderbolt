#!/usr/bin/env bash
# Put a backup-keycloak.sh archive back, replacing the current database.
#
# Shipped as a script rather than as instructions in the README because the step in
# the middle is `rm -rf` inside the volume, and the place it would be typed by hand
# is an objekt, under time pressure, with the stand down.
#
# Everything in Keycloak goes back to the moment of the archive: accounts, passwords,
# sessions, and anything changed in the admin console since.
#
# Usage: scripts/restore-keycloak.sh [archive]   (default: the newest in ./data/keycloak-backup)
#        scripts/restore-keycloak.sh -y [archive]  to skip the confirmation
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

assume_yes=0
[[ "${1:-}" == "-y" ]] && { assume_yes=1; shift; }

archive="${1:-$(ls -1t data/keycloak-backup/keycloak-*.tgz 2>/dev/null | head -1)}"
[[ -n "$archive" && -f "$archive" ]] || { echo "no archive to restore (looked in data/keycloak-backup)" >&2; exit 1; }

volume="$(docker volume ls --quiet --filter 'name=_keycloak_data$' | head -1)"
[[ -n "$volume" ]] || { echo "Keycloak has no volume yet — start the stand once first (scripts/up.sh)." >&2; exit 1; }

echo "restore $archive  ->  $volume"
echo "Everything Keycloak holds now is discarded, including accounts created after that archive."
if [[ "$assume_yes" -eq 0 ]]; then
  read -r -p "type 'yes' to go ahead: " answer
  [[ "$answer" == "yes" ]] || { echo "cancelled."; exit 1; }
fi

was_running="$(docker compose ps --status running --services 2>/dev/null | grep -cx keycloak || true)"
[[ "$was_running" == "1" ]] && { echo "stopping keycloak ..."; docker compose stop keycloak >/dev/null; }

# Wiped rather than unpacked over the top: a stale H2 lock or a file the archive does
# not contain would otherwise survive and keep the server from starting. Ownership comes
# back from the archive, which is why this runs as root in the helper and not on the host.
failed=0
docker run --rm \
  -v "$volume:/kcdata" \
  -v "$(pwd)/$(dirname "$archive"):/backup:ro" \
  postgres:18-alpine sh -c "rm -rf /kcdata/* /kcdata/.[!.]* 2>/dev/null; tar xzf '/backup/$(basename "$archive")' -C /kcdata" || failed=1

[[ "$was_running" == "1" ]] && { echo "starting keycloak ..."; docker compose start keycloak >/dev/null; }
[[ "$failed" -eq 0 ]] || { echo "unpacking failed — the database may be incomplete. Restore again, from another archive." >&2; exit 1; }

echo "restored. Keycloak needs about half a minute before it answers."
