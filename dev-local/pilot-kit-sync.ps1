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

$files = Get-ChildItem -Path $source -Recurse -File
foreach ($f in $files) {
    $rel = $f.FullName.Substring($source.Length).TrimStart('\')
    $dest = Join-Path $KitPath $rel
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
Write-Host "Not touched: images/, conf/certs/, conf/voltd-keys/, .env, data/."
Write-Host "Images are rebuilt separately — see dev-local/pilot-kit/README.md."
