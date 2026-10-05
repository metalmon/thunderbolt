#Requires -Version 5.1
# Generate .\.env from conf\.env.example with random secrets, pointed at the
# given public hostname/IP. Re-run is safe: it overwrites .env, but will not
# touch an existing one unless -Force is given.
#
# Usage: scripts\gen-secrets.ps1 -PublicHost <public-hostname-or-ip> [-Tls] [-Voltd] [-Force]
#
# NOTE: the parameter is -PublicHost, not -Host. $Host is a read-only automatic
# variable in PowerShell, and a param of that name fails on every machine with
# "Cannot overwrite variable Host because it is read-only or constant" before a
# single line of the script runs.
param(
    [Parameter(Mandatory = $true)] [string]$PublicHost,
    [switch]$Tls,
    [switch]$Voltd,
    [switch]$Force
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$envPath = Join-Path $root ".env"
if ((Test-Path $envPath) -and (-not $Force)) {
    Write-Error ".env already exists — pass -Force to overwrite."
    exit 1
}

# voltd needs the backend reachable over https: the issuer it fetches discovery
# and JWKS from is rejected by the backend itself unless it is https or loopback,
# and a rejected issuer silently turns the whole feature off rather than failing
# loudly. Refuse the combination here.
if ($Voltd -and (-not $Tls)) {
    Write-Error "-Voltd requires -Tls: a non-loopback http:// issuer is refused and the feature would start up silently disabled."
    exit 1
}

function New-RandomSecret([int]$Bytes) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return [Convert]::ToBase64String($buf)
}

function New-RandomHex([int]$Bytes) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return -join ($buf | ForEach-Object { $_.ToString("x2") })
}

# Postgres applies POSTGRES_PASSWORD at initdb and never again, and
# conf\postgres\init-db\ is skipped entirely once the data directory exists. A fresh
# password here would leave the backend and PowerSync unable to log in - which for
# PowerSync means sync stops while the application itself looks perfectly healthy.
if (Test-Path (Join-Path $root "data\postgres")) {
    Write-Host "Postgres already has a data directory (.\data\postgres), so a new password" -ForegroundColor Yellow
    Write-Host "would not reach it and both the backend and PowerSync would stop being able to" -ForegroundColor Yellow
    Write-Host "log in. Change a password on a running stand with ALTER USER instead, or start" -ForegroundColor Yellow
    Write-Host "the stand over - which deletes ALL pilot data:" -ForegroundColor Yellow
    Write-Host "  docker compose down; Remove-Item -Recurse -Force data\postgres" -ForegroundColor Yellow
    exit 1
}

# Keycloak reads realm.json on first boot only, so once its database exists this script
# would put a fresh client secret in .env that Keycloak never learns - login then fails
# with nothing in either log to say why. The volume name is asked of Docker rather than
# built from the directory name, which COMPOSE_PROJECT_NAME can override.
$keycloakVolume = (docker volume ls --quiet --filter 'name=_keycloak_data$' | Select-Object -First 1)
if ($keycloakVolume) {
    Write-Host "Keycloak already has a database, so conf\keycloak\realm.json would be ignored" -ForegroundColor Yellow
    Write-Host "and the new client secret would never reach it. Either keep the current secrets," -ForegroundColor Yellow
    Write-Host "or start Keycloak over - which also deletes every account on this stand:" -ForegroundColor Yellow
    Write-Host "  docker compose down; docker volume rm $keycloakVolume" -ForegroundColor Yellow
    exit 1
}

$betterAuthSecret = New-RandomSecret 32
$powersyncSecret = New-RandomSecret 32
$postgresPassword = New-RandomSecret 24
# The role PowerSync replicates as. Hex rather than base64 so it survives a URI: the
# password is interpolated into postgresql://... in docker-compose.yml, where a `/` or
# `+` from base64 would have to be percent-encoded.
$powersyncDbPassword = New-RandomHex 24
$keycloakAdminPassword = New-RandomSecret 18
# The realm's client secret is generated too, and written into BOTH .env and
# realm.json below. The committed placeholder is the same on every copy of the
# kit, and "remember to change it by hand in two files" is not a control.
$oidcClientSecret = New-RandomHex 16

# The JWK form of the PowerSync secret, for conf\powersync\config.yaml's `k`. base64URL:
# the standard alphabet's `+` and `/` are not valid in a JWK, and a key that merely fails
# to parse would take sync down without touching anything the operator can see.
$powersyncSecretK = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($powersyncSecret)).TrimEnd('=').Replace('+', '-').Replace('/', '_')

if ($Tls) {
    $publicUrl = "https://$PublicHost"
    $keycloakPublicUrl = "https://${PublicHost}:8444"
} else {
    $publicUrl = "http://${PublicHost}:3000"
    $keycloakPublicUrl = "http://${PublicHost}:8180"
}

Copy-Item (Join-Path $root "conf\.env.example") $envPath -Force
$content = Get-Content $envPath -Raw
$content = $content -replace '(?m)^PUBLIC_URL=.*', "PUBLIC_URL=$publicUrl"
$content = $content -replace '(?m)^KEYCLOAK_PUBLIC_URL=.*', "KEYCLOAK_PUBLIC_URL=$keycloakPublicUrl"
$content = $content -replace '(?m)^VOLT_TLS_SERVER_NAME=.*', "VOLT_TLS_SERVER_NAME=$PublicHost"
$content = $content -replace '(?m)^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$postgresPassword"
$content = $content -replace '(?m)^BETTER_AUTH_SECRET=.*', "BETTER_AUTH_SECRET=$betterAuthSecret"
$content = $content -replace '(?m)^POWERSYNC_JWT_SECRET=.*', "POWERSYNC_JWT_SECRET=$powersyncSecret"
$content = $content -replace '(?m)^POWERSYNC_JWT_K=.*', "POWERSYNC_JWT_K=$powersyncSecretK"
$content = $content -replace '(?m)^POWERSYNC_DB_PASSWORD=.*', "POWERSYNC_DB_PASSWORD=$powersyncDbPassword"
$content = $content -replace '(?m)^KEYCLOAK_ADMIN_PASSWORD=.*', "KEYCLOAK_ADMIN_PASSWORD=$keycloakAdminPassword"
$content = $content -replace '(?m)^OIDC_CLIENT_SECRET=.*', "OIDC_CLIENT_SECRET=$oidcClientSecret"
if ($Voltd) {
    # The backend's own TLS hop to voltd is made by Bun, whose root store knows
    # nothing about the pilot CA. Without this the roster call fails with "unable
    # to verify the first certificate" and no agent is ever published.
    $content = $content -replace '(?m)^VOLT_BACKEND_EXTRA_CA=.*', "VOLT_BACKEND_EXTRA_CA=/etc/volt/certs/ca.crt.pem"
}
Set-Content -Path $envPath -Value $content -NoNewline

# Point the realm's client at the SAME origin as PUBLIC_URL. Keycloak matches
# redirect_uri exactly, so a realm left on http://localhost:3000 refuses the SSO
# callback with "Invalid parameter: redirect_uri" on every host that is not the
# operator's own laptop — i.e. every real pilot. Matched on the URL's shape, not
# the literal localhost origin, so a second run with a new host still repoints it.
$realmPath = Join-Path $root "conf\keycloak\realm.json"
$realm = Get-Content $realmPath -Raw
$realm = $realm -replace '"https?://[^"]*/v1/api/auth/sso/callback/sso"', "`"$publicUrl/v1/api/auth/sso/callback/sso`""
$realm = $realm -replace '"https?://[^"]*/\*"', "`"$publicUrl/*`""
$realm = $realm -replace '"https?://[^"/]*"', "`"$publicUrl`""
$realm = $realm -replace '"secret": "[^"]*"', "`"secret`": `"$oidcClientSecret`""
Set-Content -Path $realmPath -Value $realm -NoNewline

if (-not $Tls) {
    # No terminator in front, so the SPA and Keycloak have to be reachable on the
    # LAN directly. Every other published port stays on loopback either way. The
    # template's line is rewritten rather than a second one appended: compose
    # would honour the last, but a file a human reads must not state it twice.
    $content = Get-Content $envPath -Raw
    $content = $content -replace '(?m)^VOLT_BIND_ADDR=.*', 'VOLT_BIND_ADDR=0.0.0.0'
    Set-Content -Path $envPath -Value $content -NoNewline
    Write-Host "NOTE: no -Tls, so web and Keycloak are published on 0.0.0.0 in plain HTTP."
}

Write-Host "Wrote .env (PUBLIC_URL=$publicUrl, KEYCLOAK_PUBLIC_URL=$keycloakPublicUrl)"
Write-Host "PowerSync reads its Postgres URIs and HS256 key from .env - nothing to edit."
Write-Host "Repointed conf\keycloak\realm.json's redirect URIs at $publicUrl and gave"
Write-Host "  the volt-app client a fresh secret (same value in .env and realm.json)."
Write-Host "AI provider key was left as-is — see .env comments."
Write-Host "The realm ships with NO users: create them in the Keycloak admin console at"
Write-Host "  $keycloakPublicUrl/admin (user 'admin', password in .env), then put each"
Write-Host "  one in volt-admins / volt-avk / volt-kb as needed."

if ($Voltd) {
    # voltd agent auto-discovery: merge the overlay and name the gateway. The
    # backend reads these from .env (its env_file), so they must not also appear
    # in the compose `environment:` block — see docker-compose.voltd.yml.
    $voltdBlock = @"

# ============================================================
# voltd agent auto-discovery (added by gen-secrets.ps1 -Voltd)
# ============================================================

# Merge docker-compose.voltd.yml on top of docker-compose.yml for every
# ``docker compose`` call. COMPOSE_PATH_SEPARATOR is required: compose defaults
# it to ';' on Windows, which would read the ':' below as part of a file name.
COMPOSE_FILE=docker-compose.yml:docker-compose.voltd.yml
COMPOSE_PATH_SEPARATOR=:

# voltd's public ACP endpoint. Unset/empty = feature off (no agents published,
# no relay route). Must be wss:// unless it is loopback.
VOLTD_URL=wss://${PublicHost}:8443/acp

# The ``iss`` our access tokens carry and the base voltd fetches
# /.well-known/openid-configuration + /voltd/jwks from. MUST equal ``issuer``
# in voltd's [oidc.volt] block, including the /v1.
VOLTD_ISSUER=$publicUrl/v1

# Dotted path to the group claim Keycloak emits (the realm's Group Membership
# mapper writes ``groups``). Must equal ``claim_path`` in [oidc.volt].
VOLTD_GROUPS_CLAIM=groups
"@
    Add-Content -Path $envPath -Value $voltdBlock

    Write-Host "voltd enabled: VOLTD_URL=wss://${PublicHost}:8443/acp, VOLTD_ISSUER=$publicUrl/v1"
    Write-Host "  1) scripts\gen-voltd-keys.ps1   (ES256 keypair the tokens are signed with)"
    Write-Host "  2) copy certs\out\ca.crt.pem into conf\certs\  (Bun must trust voltd's leaf)"
    Write-Host "  3) on the voltd side: uncomment [oidc.volt], issuer = $publicUrl/v1"
}

if ($Tls) {
    Write-Host "TLS profile requested: put fullchain.pem + privkey.pem in conf\certs\ before 'up.ps1 -Tls'."
}
