#Requires -Version 5.1
<#
.SYNOPSIS
Refresh everything in the pilot kit's backend/ folder that goes stale when
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
pwsh dev-local/pilot-kit-refresh.ps1 -KitPath E:\zeroclaw\_local\pilot-kit\backend -RunId 37223264780
pwsh dev-local/pilot-kit-refresh.ps1 -KitPath E:\...\backend -RunId 37223264780 -Skip images
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$KitPath,
    # The Build All Platforms run whose artifacts become desktop/. Find one with:
    #   gh run list -R metalmon/thunderbolt --workflow build-all.yml
    [string]$RunId,
    [ValidateSet('desktop', 'images', 'config')] [string[]]$Skip = @(),
    # Where the installers live. The kit moved them out of `backend/desktop`
    # into a top-level `volt-client/` — pointing at the old path simply recreates
    # it as a 160 MB duplicate of what the operator already carries.
    [string]$ClientPath,
    [string]$Repo = 'metalmon/thunderbolt',
    [string]$ComposeProject = 'bucher-thunderbolt'
)
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $KitPath "docker-compose.yml"))) {
    Write-Error "$KitPath does not look like the kit's backend folder (no docker-compose.yml)."
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

    # Advisory only — a failure here (GitHub's secondary rate limit fires readily
    # after a burst of gh calls) must not stop the refresh, and must not look like
    # a null-reference crash either.
    $runSha = $null
    try { $runSha = (gh run view $RunId -R $Repo --json headSha --jq .headSha 2>$null | Out-String).Trim() } catch { }
    if ($runSha) {
        if ($runSha -notlike "$head*") {
            Write-Warning "run $RunId built $($runSha.Substring(0, 9)), but master is at $head — the installers will not match this checkout."
        }
    } else {
        Write-Warning "could not read run $RunId (rate limit?); skipping the commit check and trying the download anyway."
    }

    # Download into a staging directory FIRST and only then replace what the kit
    # has. Clearing up front and failing on the download — which is exactly what a
    # rate limit does — would leave the kit with no installers at all.
    $desktop = if ($ClientPath) { $ClientPath } else { Join-Path (Split-Path -Parent $KitPath) 'volt-client' }
    if (-not (Test-Path $desktop)) {
        Write-Error "no installer directory at $desktop — pass -ClientPath if the kit moved it again."
        exit 1
    }
    $staging = Join-Path ([System.IO.Path]::GetTempPath()) "volt-kit-desktop-$RunId"
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $staging | Out-Null

    Write-Host "downloading artifacts of run $RunId ..." -ForegroundColor Cyan
    gh run download $RunId -R $Repo -D $staging
    $fetched = @(Get-ChildItem $staging -Recurse -File)
    if ($LASTEXITCODE -ne 0 -or $fetched.Count -eq 0) {
        Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
        Write-Warning "artifact download failed — desktop/ left untouched."
        Write-Warning "Retry later with:  -Skip images,config"
        Write-Warning "or download them by hand from https://github.com/$Repo/actions/runs/$RunId"
        Write-Warning "and unzip each artifact into desktop/<artifact name>/."
        exit 1
    }

    foreach ($dir in Get-ChildItem $staging -Directory) {
        $target = Join-Path $desktop $dir.Name
        if (Test-Path $target) { Remove-Item (Join-Path $target '*') -Recurse -Force }
        else { New-Item -ItemType Directory -Force -Path $target | Out-Null }
        Copy-Item (Join-Path $dir.FullName '*') $target -Recurse -Force
    }
    Remove-Item $staging -Recurse -Force
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
        @{ src = "$ComposeProject-backend:latest"; tag = 'volt-backend:pilot'; file = 'volt-backend.tar.gz' },
        @{ src = "$ComposeProject-web:latest"; tag = 'volt-web:pilot'; file = 'volt-web.tar.gz' }
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
if ($Skip -notcontains 'images') {
    Write-Host "  - Образы бэкенда и веб-клиента «Вольт»: собраны из master $head"
}
if ($Skip -notcontains 'desktop') {
    $builtFrom = if ($runSha) { $runSha.Substring(0, 9) } else { $head }
    Write-Host "  - Приложение «Вольт» (volt-client/): сборка master $builtFrom, прогон CI $RunId"
} else {
    Write-Host "  - Десктоп НЕ обновлялся этим запуском: в volt-client/ остается прежняя сборка." -ForegroundColor Yellow
    Write-Host "    Не приписывайте ему $head в README." -ForegroundColor Yellow
}
