#Requires -Version 5.1
<#
.SYNOPSIS
Copy of Keycloak's database — the pilot's whole account list.

.DESCRIPTION
Cold copy, with the server stopped. That is not caution, it is the only complete one:
the accounts live in an embedded H2 file, and Keycloak's own realm export (admin
console, admin API) deliberately omits credentials, so an export cannot restore a
login. Keycloak is down while the archive is written — seconds.

The helper container is postgres:18-alpine because the kit already ships it and the
perimeter is closed; the Keycloak image itself has no tar. Nothing is pulled.

Keeps the last 7 archives. Restore with scripts\restore-keycloak.ps1.
#>
[CmdletBinding()]
param([string]$Dest = "data\keycloak-backup")
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$volume = (docker volume ls --quiet --filter 'name=_keycloak_data$' | Select-Object -First 1)
if (-not $volume) { Write-Error "Keycloak has no database yet — nothing to back up."; exit 1 }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
# The archive is Keycloak's whole database, password hashes of every pilot account
# included, so the folder is taken off inherited permissions and granted to this user
# alone. On a drive without ACL support (FAT32 flash drive) icacls fails and says so,
# which is itself worth knowing before copying backups onto one.
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $Dest /inheritance:r /grant:r "${me}:(OI)(CI)F" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host "note: could not restrict permissions on $Dest" -ForegroundColor Yellow }
$archive = "keycloak-$(Get-Date -Format 'yyyyMMdd-HHmmss').tgz"

# Only restarted if it was up, so running this on a stopped stand leaves it stopped.
$wasRunning = (docker compose ps --status running --services) -contains "keycloak"
if ($wasRunning) { Write-Host "stopping keycloak ..."; docker compose stop keycloak | Out-Null }

Write-Host "archiving $volume -> $Dest\$archive ..."
docker run --rm -v "${volume}:/kcdata:ro" -v "$((Resolve-Path $Dest).Path):/backup" `
    postgres:18-alpine sh -c "umask 077 && tar czf '/backup/$archive' -C /kcdata ."
$failed = $LASTEXITCODE -ne 0

if ($wasRunning) { Write-Host "starting keycloak ..."; docker compose start keycloak | Out-Null }
if ($failed) { Write-Error "tar failed — the archive is not usable."; exit 1 }

Get-ChildItem "$Dest\keycloak-*.tgz" | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 7 | Remove-Item -Force

Write-Host "done:"
Get-ChildItem "$Dest\keycloak-*.tgz" | Sort-Object LastWriteTime -Descending |
    Select-Object -First 3 Name, Length, LastWriteTime | Format-Table -AutoSize
