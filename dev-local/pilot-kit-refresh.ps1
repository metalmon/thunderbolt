#Requires -Version 5.1
<#
.SYNOPSIS
Refresh everything in the pilot kit's thunderbolt/ folder that goes stale when
master moves: the desktop installers, the two container images, and our config.

.DESCRIPTION
Three things rot independently and all three bit us at once on 2026-10-04 — the
kit shipped installers built before that day's localization fixes and backend/web
images from two weeks earlier, with no voltd in them at all. This does all three
from one place so they cannot drift apart again:

  1. desktop/   <- the artifacts of a Build All Platforms run (CI, not a local build)
  2. images/    <- docker save of the backend and web images, built from master
  3. conf/ + scripts/ <- dev-local/pilot-kit-sync.ps1

Build the images from master, never from a fork branch: a branch working tree is
missing whatever the other branches carry, and a backend image built off fork/dev
has no src/fork/voltd/** at all — the only symptom is a 404 on the discovery routes.

.EXAMPLE
pwsh dev-local/pilot-kit-refresh.ps1 -KitPath E:\zeroclaw\_local\pilot-kit\thunderbolt -RunId 37223264780
pwsh dev-local/pilot-kit-refresh.ps1 -KitPath E:\...\thunderbolt -RunId 37223264780 -Skip images
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$KitPath,
    # The Build All Platforms run whose artifacts become desktop/. Find one with:
    #   gh run list -R metalmon/thunderbolt --workflow build-all.yml
    [string]$RunId,
    [ValidateSet('desktop', 'images', 'config')] [string[]]$Skip = @(),
    [string]$Repo = 'metalmon/thunderbolt',
    [string]$ComposeProject = 'bucher-thunderbolt'
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $KitPath "docker-compose.yml"))) {
    Write-Error "$KitPath does not look like the kit's thunderbolt folder (no docker-compose.yml)."
    exit 1
}

$branch = (git -C $repoRoot rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'master') {
    Write-Error "Build from master, not '$branch' — a fork branch's tree is missing the other branches' files."
    exit 1
}
$head = (git -C $repoRoot rev-parse --short HEAD).Trim()
Write-Host "repo at master $head" -ForegroundColor Cyan

# ── 1. desktop installers, from CI ────────────────────────────────────────────
if ($Skip -notcontains 'desktop') {
    if (-not $RunId) { Write-Error "-RunId is required unless -Skip desktop. See the help."; exit 1 }
    $runSha = (gh run view $RunId -R $Repo --json headSha --jq .headSha).Trim()
    if ($runSha -notlike "$head*") {
        Write-Warning "run $RunId built $($runSha.Substring(0,9)), but master is at $head — the installers will not match this checkout."
    }
    $desktop = Join-Path $KitPath "desktop"
    # gh refuses to write over an existing artifact directory, and leaving the old
    # bundles behind would ship two versions side by side.
    Get-ChildItem $desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  clearing $($_.Name)"
        Remove-Item (Join-Path $_.FullName '*') -Recurse -Force
    }
    Write-Host "downloading artifacts of run $RunId into desktop/ ..." -ForegroundColor Cyan
    gh run download $RunId -R $Repo -D $desktop
    Get-ChildItem $desktop -Recurse -File | ForEach-Object {
        Write-Host ("  {0,-46} {1,6:N1} MB" -f $_.Name, ($_.Length / 1MB))
    }
}

# ── 2. container images, built here from master ───────────────────────────────
if ($Skip -notcontains 'images') {
    $compose = Join-Path $repoRoot "powersync-service/docker-compose.yml"
    Write-Host "building backend + web from master ..." -ForegroundColor Cyan
    docker compose -p $ComposeProject -f $compose build backend web
    if ($LASTEXITCODE -ne 0) { Write-Error "image build failed"; exit 1 }

    $pairs = @(
        @{ src = "$ComposeProject-backend:latest"; tag = 'thunderbolt-backend:pilot'; file = 'thunderbolt-backend.tar.gz' },
        @{ src = "$ComposeProject-web:latest"; tag = 'thunderbolt-web:pilot'; file = 'thunderbolt-web.tar.gz' }
    )
    foreach ($p in $pairs) {
        docker tag $p.src $p.tag
        $out = Join-Path $KitPath "images/$($p.file)"
        Write-Host "  saving $($p.tag) -> images/$($p.file) ..."
        # -o rather than a pipe: PowerShell's pipeline mangles binary, and the two
        # byte-stream parameter names differ between 5.1 and 7.
        docker save $p.tag -o "$out.raw"
        if ($LASTEXITCODE -ne 0) { Write-Error "docker save failed for $($p.tag)"; exit 1 }
        # PowerShell 5.1 has no gzip cmdlet; use .NET rather than assuming gzip.exe.
        $in = [System.IO.File]::OpenRead("$out.raw")
        $fs = [System.IO.File]::Create($out)
        $gz = New-Object System.IO.Compression.GzipStream($fs, [System.IO.Compression.CompressionLevel]::Optimal)
        $in.CopyTo($gz); $gz.Dispose(); $fs.Dispose(); $in.Dispose()
        Remove-Item "$out.raw" -Force
        Write-Host ("    {0,6:N1} MB" -f ((Get-Item $out).Length / 1MB))
    }
}

# ── 3. our config and scripts ─────────────────────────────────────────────────
if ($Skip -notcontains 'config') {
    & (Join-Path $PSScriptRoot "pilot-kit-sync.ps1") -KitPath $KitPath
}

Write-Host ""
Write-Host "Still by hand: the kit's own README version list." -ForegroundColor Yellow
Write-Host "  - Volt desktop: 0.1.134 (сборка master metalmon/thunderbolt $head)"
Write-Host "  - Thunderbolt backend/web: образы собраны из master $head"
Write-Host "  (the current text says the images came from the dev stand on 2026-10-04;"
Write-Host "   they were in fact two weeks older than that until this run.)"
