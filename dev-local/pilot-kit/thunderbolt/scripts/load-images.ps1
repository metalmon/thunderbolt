#Requires -Version 5.1
# Load every pilot-kit image tar into the local Docker daemon.
# Run this first, before gen-secrets/up, on the air-gapped host.
$ErrorActionPreference = "Stop"
$imagesDir = Join-Path (Split-Path -Parent $PSScriptRoot) "images"
Set-Location $imagesDir

$images = @("volt-web.tar.gz", "volt-backend.tar.gz", "keycloak.tar.gz", "powersync.tar.gz", "postgres.tar.gz")
$missing = $false
foreach ($f in $images) {
    if (-not (Test-Path $f)) {
        Write-Error "MISSING: images\$f"
        $missing = $true
    }
}
if ($missing) {
    Write-Error "Aborting: one or more image tars are missing."
    exit 1
}

foreach ($f in $images) {
    Write-Host "==> docker load < $f"
    # docker load reads gzip directly; no need to decompress first.
    docker load -i $f
    if ($LASTEXITCODE -ne 0) { throw "docker load failed for $f" }
}

Write-Host "==> Loaded images:"
docker images --format "{{.Repository}}:{{.Tag}}  {{.Size}}" | Select-String -Pattern '^(volt-web|volt-backend|quay.io/keycloak/keycloak|journeyapps/powersync-service|postgres):'
