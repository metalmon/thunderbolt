#Requires -Version 5.1
# Generate the ES256 keypair the backend signs voltd access tokens with, into
# .\conf\voltd-keys\. Re-run is a no-op unless -Force is given.
#
# The keypair is produced by Bun's WebCrypto inside the backend image rather
# than on the host: PowerShell 5.1 has no PKCS#8 export for ECDsa, and the kit
# does not assume openssl on a Windows host.
#
# Usage: scripts\gen-voltd-keys.ps1 [-Force]
param([switch]$Force)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$out = Join-Path $root "conf\voltd-keys"
$image = if ($env:THUNDERBOLT_BACKEND_IMAGE) { $env:THUNDERBOLT_BACKEND_IMAGE } else { "thunderbolt-backend:pilot" }

New-Item -ItemType Directory -Force -Path $out | Out-Null
$keyPath = Join-Path $out "signing.key.pem"
if ((Test-Path $keyPath) -and (-not $Force)) {
    Write-Error "conf\voltd-keys\signing.key.pem already exists — pass -Force to replace the keypair."
    exit 1
}

# PKCS#8 private key + SPKI public key — what the backend's importPKCS8 /
# importSPKI expect. Single-quoted here-string: no PowerShell interpolation, so
# the JS reaches Bun verbatim.
$js = @'
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
const pem = (label, der) =>
  "-----BEGIN " + label + "-----\n" +
  Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "") +
  "\n-----END " + label + "-----\n"
await Bun.write("/out/signing.key.pem", pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", kp.privateKey)))
await Bun.write("/out/signing.pub.pem", pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", kp.publicKey)))
'@

docker run --rm -v "${out}:/out" --entrypoint bun $image -e $js
if ($LASTEXITCODE -ne 0) { Write-Error "keypair generation failed (image $image)"; exit 1 }

Write-Host "Wrote conf\voltd-keys\signing.key.pem and signing.pub.pem."
Write-Host "Keep the private key off the flash drive after the pilot, like certs\out\ca.key.pem."
