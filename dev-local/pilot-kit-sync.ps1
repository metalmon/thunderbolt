#Requires -Version 5.1
<#
.SYNOPSIS
Copy our half of the Volt pilot kit (dev-local/pilot-kit/thunderbolt) into a
kit checkout.

.DESCRIPTION
The kit's `thunderbolt/` folder is our deliverable inside someone else's staging
tree, so it drifts from this repo the moment either side changes. Everything in
dev-local/pilot-kit/thunderbolt is authored here and copied there — never edited
in place — so this script is the only sanctioned way to update it.

It copies files only; it never deletes anything in the kit, and it never touches
the kit's images/, conf/certs/, .env or data/. Rebuilding images/*.tar.gz is a
separate step (see dev-local/pilot-kit/README.md).

.EXAMPLE
pwsh dev-local/pilot-kit-sync.ps1 -KitPath E:\zeroclaw\_local\pilot-kit\thunderbolt -WhatIf
pwsh dev-local/pilot-kit-sync.ps1 -KitPath E:\zeroclaw\_local\pilot-kit\thunderbolt
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)] [string]$KitPath
)
$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "pilot-kit\thunderbolt"
if (-not (Test-Path $source)) { Write-Error "missing $source"; exit 1 }
if (-not (Test-Path (Join-Path $KitPath "docker-compose.yml"))) {
    Write-Error "$KitPath does not look like the kit's thunderbolt folder (no docker-compose.yml)."
    exit 1
}

# conf/keycloak/realm.json is the one file scripts/gen-secrets.sh rewrites inside the
# kit — fresh client secret, redirect URIs for the real host. Copying the committed
# placeholders over that silently un-provisions the stand: the backend keeps the secret
# from .env while the realm goes back to `volt-dev-secret`. (It did, once.) So a realm
# that has been provisioned is reported and left alone rather than overwritten.
$provisionedRealm = {
    param($dest)
    (Test-Path $dest) -and -not ((Get-Content -LiteralPath $dest -Raw) -match '"secret"\s*:\s*"volt-dev-secret"')
}

$files = Get-ChildItem -Path $source -Recurse -File
$skippedRealm = $false
foreach ($f in $files) {
    $rel = $f.FullName.Substring($source.Length).TrimStart('\')
    $dest = Join-Path $KitPath $rel
    if ($rel -eq "conf\keycloak\realm.json" -and (& $provisionedRealm $dest)) {
        $skippedRealm = $true
        Write-Host ("{0,-9} {1}  (gen-secrets has provisioned it)" -f "kept", $rel)
        continue
    }
    $exists = Test-Path $dest
    $same = $exists -and ((Get-FileHash $f.FullName).Hash -eq (Get-FileHash $dest).Hash)
    if ($same) {
        Write-Verbose "unchanged $rel"
        continue
    }
    if ($PSCmdlet.ShouldProcess($dest, $(if ($exists) { "replace" } else { "add" }))) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
    }
    Write-Host ("{0,-9} {1}" -f $(if ($exists) { "replaced" } else { "added" }), $rel)
}

Write-Host ""
if ($skippedRealm) {
    Write-Host "conf/keycloak/realm.json was kept, so any realm change in this commit is NOT" -ForegroundColor Yellow
    Write-Host "in that kit. Diff it against dev-local/pilot-kit/thunderbolt/conf/keycloak/realm.json" -ForegroundColor Yellow
    Write-Host "and apply the change by hand, or in the admin console. Note that Keycloak reads" -ForegroundColor Yellow
    Write-Host "realm.json on first boot only — on a stand that is already up, the console is the" -ForegroundColor Yellow
    Write-Host "only route that takes effect." -ForegroundColor Yellow
    Write-Host ""
}
Write-Host "Not touched: images/, conf/certs/, conf/voltd-keys/, .env, data/."
Write-Host "Images are rebuilt separately — see dev-local/pilot-kit/README.md."
