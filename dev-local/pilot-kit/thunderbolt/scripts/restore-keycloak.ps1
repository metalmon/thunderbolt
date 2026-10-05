#Requires -Version 5.1
<#
.SYNOPSIS
Put a backup-keycloak archive back, replacing the current Keycloak database.

.DESCRIPTION
Shipped as a script rather than as instructions in the README because the step in the
middle wipes the volume, and the place it would be typed by hand is an objekt, under
time pressure, with the stand down.

Everything in Keycloak goes back to the moment of the archive: accounts, passwords,
sessions, and anything changed in the admin console since.

.EXAMPLE
pwsh scripts\restore-keycloak.ps1                          # newest archive, asks first
pwsh scripts\restore-keycloak.ps1 -Archive data\keycloak-backup\keycloak-20261005-120000.tgz -Yes
#>
[CmdletBinding()]
param([string]$Archive, [switch]$Yes)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $Archive) {
    $Archive = (Get-ChildItem "data\keycloak-backup\keycloak-*.tgz" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not $Archive -or -not (Test-Path $Archive)) {
    Write-Error "no archive to restore (looked in data\keycloak-backup)"; exit 1
}

$volume = (docker volume ls --quiet --filter 'name=_keycloak_data$' | Select-Object -First 1)
if (-not $volume) { Write-Error "Keycloak has no volume yet — start the stand once first (scripts\up.ps1)."; exit 1 }

$file = Get-Item $Archive
Write-Host "restore $($file.FullName)  ->  $volume"
Write-Host "Everything Keycloak holds now is discarded, including accounts created after that archive."
if (-not $Yes) {
    if ((Read-Host "type 'yes' to go ahead") -ne "yes") { Write-Host "cancelled."; exit 1 }
}

$wasRunning = (docker compose ps --status running --services) -contains "keycloak"
if ($wasRunning) { Write-Host "stopping keycloak ..."; docker compose stop keycloak | Out-Null }

# Wiped rather than unpacked over the top: a stale H2 lock or a file the archive does
# not contain would otherwise survive and keep the server from starting. Ownership comes
# back from the archive, which is why this runs in the helper container and not here.
docker run --rm -v "${volume}:/kcdata" -v "$($file.Directory.FullName):/backup:ro" `
    postgres:18-alpine sh -c "rm -rf /kcdata/* /kcdata/.[!.]* 2>/dev/null; tar xzf '/backup/$($file.Name)' -C /kcdata"
$failed = $LASTEXITCODE -ne 0

if ($wasRunning) { Write-Host "starting keycloak ..."; docker compose start keycloak | Out-Null }
if ($failed) { Write-Error "unpacking failed — Keycloak's database may be incomplete. Restore again from another archive."; exit 1 }

Write-Host "restored. Keycloak needs about half a minute before it answers."
