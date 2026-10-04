#!/usr/bin/env bash
# Load every pilot-kit image tar into the local Docker daemon.
# Run this first, before gen-secrets/up, on the air-gapped host.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../images"

images=(volt-web.tar.gz volt-backend.tar.gz keycloak.tar.gz powersync.tar.gz postgres.tar.gz)
missing=0
for f in "${images[@]}"; do
  [[ -f "$f" ]] || { echo "MISSING: images/$f" >&2; missing=1; }
done
[[ "$missing" -eq 0 ]] || { echo "Aborting: one or more image tars are missing." >&2; exit 1; }

for f in "${images[@]}"; do
  echo "==> docker load -i $f"
  docker load -i "$f"
done

echo "==> Loaded images:"
docker images --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E '^(volt-web|volt-backend|quay.io/keycloak/keycloak|journeyapps/powersync-service|postgres):'
