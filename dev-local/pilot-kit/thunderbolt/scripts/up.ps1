#Requires -Version 5.1
# Bring the pilot stack up. Usage: scripts\up.ps1 [-Tls]
param([switch]$Tls)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path ".env")) {
    Write-Error "No .env found - run scripts\gen-secrets.ps1 -Host <host> first."
    exit 1
}

$requiredImages = @("volt-web:pilot", "volt-backend:pilot", "quay.io/keycloak/keycloak:26.0", "journeyapps/powersync-service:latest", "postgres:18-alpine")
$have = docker images --format "{{.Repository}}:{{.Tag}}"
$missing = $false
foreach ($img in $requiredImages) {
    if (-not ($have -contains $img)) {
        Write-Error "MISSING image: $img - run scripts\load-images.ps1 first."
        $missing = $true
    }
}
if ($missing) { exit 1 }

$profileArgs = @()
if ($Tls) {
    $profileArgs = @("--profile", "tls")
    if (-not (Select-String -Path ".env" -Pattern '^VOLT_TLS_SERVER_NAME=.+' -Quiet)) {
        Write-Error "VOLT_TLS_SERVER_NAME is not set in .env - required for -Tls."
        exit 1
    }
    if (-not ((Test-Path "conf\certs\fullchain.pem") -and (Test-Path "conf\certs\privkey.pem"))) {
        Write-Error "conf\certs\fullchain.pem + privkey.pem are missing - required for -Tls (see README-pilot-tls.md)."
        exit 1
    }
}

docker compose -f docker-compose.yml @profileArgs up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

$envVars = @{}
Get-Content ".env" | ForEach-Object {
    if ($_ -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $envVars[$Matches[1]] = $Matches[2] }
}

Write-Host ""
Write-Host "==> URLs"
Write-Host "App:       $($envVars['PUBLIC_URL'])"
Write-Host "Keycloak:  $($envVars['KEYCLOAK_PUBLIC_URL']) (admin console: /admin, user admin)"
Write-Host ""
Write-Host "==> OTP / magic-link (email is log-only in this kit)"
Write-Host "docker compose logs backend | Select-String -Pattern 'otp|magic'"
