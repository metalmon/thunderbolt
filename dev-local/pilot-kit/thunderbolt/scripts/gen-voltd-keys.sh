#!/usr/bin/env bash
# Generate the ES256 keypair the backend signs voltd access tokens with, into
# ./conf/voltd-keys/. Re-run is a no-op unless -f is given (rotating the key
# makes voltd re-fetch JWKS on the next token — harmless but pointless).
#
# No openssl on the host is needed: the keypair is produced by Bun's WebCrypto
# inside the backend image, the same way certs/gen-certs borrows openssl from
# the voltd image. The container runs as the invoking user so the PEMs are not
# left root-owned.
#
# Usage: scripts/gen-voltd-keys.sh [-f]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

force=0
[[ "${1:-}" == "-f" ]] && force=1
out="conf/voltd-keys"
image="${THUNDERBOLT_BACKEND_IMAGE:-thunderbolt-backend:pilot}"

mkdir -p "$out"
if [[ -f "$out/signing.key.pem" && "$force" -ne 1 ]]; then
  echo "$out/signing.key.pem already exists — pass -f to replace the keypair." >&2
  exit 1
fi

# PKCS#8 private key + SPKI public key, which is exactly what the backend's
# importPKCS8 / importSPKI expect. The public half is only used to publish the
# JWK (and its RFC 7638 thumbprint as `kid`) at /v1/voltd/jwks.
read -r -d '' js <<'JS' || true
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
const pem = (label, der) =>
  "-----BEGIN " + label + "-----\n" +
  Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "") +
  "\n-----END " + label + "-----\n"
await Bun.write("/out/signing.key.pem", pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", kp.privateKey)))
await Bun.write("/out/signing.pub.pem", pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", kp.publicKey)))
JS

docker run --rm --user "$(id -u):$(id -g)" \
  -v "$root/$out:/out" --entrypoint bun "$image" -e "$js"

chmod 600 "$out/signing.key.pem"
chmod 644 "$out/signing.pub.pem"
echo "Wrote $out/signing.key.pem (0600) and $out/signing.pub.pem."
echo "Keep the private key off the flash drive after the pilot, like certs/out/ca.key.pem."
